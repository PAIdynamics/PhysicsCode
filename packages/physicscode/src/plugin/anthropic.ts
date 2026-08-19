import type { Hooks, PluginInput } from "@physicscode-ai/plugin"
import * as Log from "@physicscode-ai/core/util/log"
import { OAUTH_DUMMY_KEY } from "../auth"

const log = Log.create({ service: "plugin.anthropic" })

// Same client ID/endpoints Anthropic's own Claude Code CLI uses for
// Claude Pro/Max login and console API-key minting. There is no local
// callback server here (unlike codex.ts) - Anthropic's authorize page
// redirects to a hosted console.anthropic.com page that shows a code for
// the user to copy and paste back, so both methods use `method: "code"`.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
const TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token"
const CREATE_API_KEY_ENDPOINT = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key"
const ANTHROPIC_BETA_HEADER =
  "oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export async function buildAuthorizeUrl(mode: "max" | "console"): Promise<{ url: string; verifier: string }> {
  const pkce = await generatePKCE()
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "org:create_api_key user:profile user:inference",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.verifier,
  })
  const host = mode === "console" ? "console.anthropic.com" : "claude.ai"
  return { url: `https://${host}/oauth/authorize?${params.toString()}`, verifier: pkce.verifier }
}

interface TokenResponse {
  refresh_token: string
  access_token: string
  expires_in: number
}

interface Tokens {
  refresh: string
  access: string
  expires: number
}

export class ExchangeFailedError extends Error {
  constructor() {
    super("Exchange failed")
  }
}

// The pasted code is formatted as "<code>#<state>" by Anthropic's hosted
// callback page - state doubles as a check that the exchange matches the
// authorize request that produced this verifier.
export async function exchangeCode(pasted: string, verifier: string): Promise<Tokens> {
  const [code, state] = pasted.split("#")
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      state: state ?? verifier,
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })
  if (!response.ok) throw new ExchangeFailedError()
  const json = (await response.json()) as TokenResponse
  return {
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<Tokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`)
  const json = (await response.json()) as TokenResponse
  return {
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

export async function createApiKey(access: string): Promise<string> {
  const response = await fetch(CREATE_API_KEY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/plain, */*",
    },
  })
  if (!response.ok) throw new Error(`Failed to create API key: ${response.status}`)
  const json = (await response.json()) as { raw_key: string }
  return json.raw_key
}

export async function AnthropicAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            let access = currentAuth.access
            if (!access || currentAuth.expires < Date.now()) {
              log.info("refreshing anthropic access token")
              const tokens = await refreshAccessToken(currentAuth.refresh)
              await input.client.auth.set({
                path: { id: "anthropic" },
                body: {
                  type: "oauth",
                  refresh: tokens.refresh,
                  access: tokens.access,
                  expires: tokens.expires,
                },
              })
              access = tokens.access
            }

            const headers = new Headers(init?.headers)
            headers.set("authorization", `Bearer ${access}`)
            headers.set("anthropic-beta", ANTHROPIC_BETA_HEADER)
            headers.delete("x-api-key")

            return fetch(requestInput, { ...init, headers })
          },
        }
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await buildAuthorizeUrl("max")
            return {
              url,
              instructions: "Complete authorization in your browser, then paste the code shown back here.",
              method: "code" as const,
              callback: async (pasted: string) => {
                try {
                  const tokens = await exchangeCode(pasted, verifier)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh,
                    access: tokens.access,
                    expires: tokens.expires,
                  }
                } catch {
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          label: "Create API Key",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await buildAuthorizeUrl("console")
            return {
              url,
              instructions: "Complete authorization in your browser, then paste the code shown back here.",
              method: "code" as const,
              callback: async (pasted: string) => {
                try {
                  const tokens = await exchangeCode(pasted, verifier)
                  const key = await createApiKey(tokens.access)
                  return { type: "success" as const, key }
                } catch {
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
