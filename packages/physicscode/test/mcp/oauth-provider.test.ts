import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { McpAuth } from "@/mcp/auth"
import { McpOAuthProvider, OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, parseRedirectUri } from "@/mcp/oauth-provider"

let counter = 0
const uniqueName = (label: string) => `${label}-${Date.now()}-${counter++}`

async function getAuth() {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* McpAuth.Service
    }).pipe(Effect.provide(McpAuth.defaultLayer)),
  )
}

function makeProvider(
  mcpName: string,
  auth: McpAuth.Interface,
  opts?: { config?: Record<string, unknown>; onRedirect?: (url: URL) => void },
) {
  const redirects: URL[] = []
  const provider = new McpOAuthProvider(
    mcpName,
    "https://mcp.example.com",
    (opts?.config as any) ?? {},
    { onRedirect: opts?.onRedirect ?? ((url) => redirects.push(url)) },
    auth,
  )
  return { provider, redirects }
}

describe("mcp.McpOAuthProvider", () => {
  test("redirectUrl defaults to the local callback server", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("redirect"), auth)
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  })

  test("redirectUrl uses a configured redirectUri when set", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("redirect"), auth, {
      config: { redirectUri: "https://app.example.com/callback" },
    })
    expect(provider.redirectUrl).toBe("https://app.example.com/callback")
  })

  test("clientMetadata requires no client auth method when there's no client secret", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("meta"), auth)
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none")
    expect(provider.clientMetadata.redirect_uris).toEqual([provider.redirectUrl])
  })

  test("clientMetadata uses client_secret_post when a client secret is configured", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("meta"), auth, {
      config: { clientId: "abc", clientSecret: "shh" },
    })
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("client_secret_post")
  })

  test("clientInformation returns the pre-registered config client without touching storage", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("clientinfo"), auth, {
      config: { clientId: "configured-id", clientSecret: "configured-secret" },
    })
    const info = await provider.clientInformation()
    expect(info).toEqual({ client_id: "configured-id", client_secret: "configured-secret" })
  })

  test("clientInformation returns undefined when nothing is registered or stored", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("clientinfo"), auth)
    expect(await provider.clientInformation()).toBeUndefined()
  })

  test("saveClientInformation persists, and clientInformation reads it back", async () => {
    const auth = await getAuth()
    const name = uniqueName("clientinfo")
    const { provider } = makeProvider(name, auth)

    await provider.saveClientInformation({
      client_id: "dyn-id",
      client_secret: "dyn-secret",
      redirect_uris: [provider.redirectUrl],
    } as any)

    expect(await provider.clientInformation()).toEqual({ client_id: "dyn-id", client_secret: "dyn-secret" })
  })

  test("clientInformation returns undefined once the stored client secret has expired", async () => {
    const auth = await getAuth()
    const name = uniqueName("clientinfo")
    const { provider } = makeProvider(name, auth)

    await provider.saveClientInformation({
      client_id: "dyn-id",
      client_secret: "dyn-secret",
      client_secret_expires_at: Math.floor(Date.now() / 1000) - 60,
      redirect_uris: [provider.redirectUrl],
    } as any)

    expect(await provider.clientInformation()).toBeUndefined()
  })

  test("tokens returns undefined before anything is saved", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("tokens"), auth)
    expect(await provider.tokens()).toBeUndefined()
  })

  test("saveTokens persists, and tokens reads them back with a computed expires_in", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("tokens"), auth)

    await provider.saveTokens({
      access_token: "access-1",
      token_type: "Bearer",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: "read write",
    })

    const tokens = await provider.tokens()
    expect(tokens?.access_token).toBe("access-1")
    expect(tokens?.refresh_token).toBe("refresh-1")
    expect(tokens?.token_type).toBe("Bearer")
    expect(tokens?.scope).toBe("read write")
    // Allow a little slack for real elapsed time between save and read.
    expect(tokens?.expires_in).toBeGreaterThan(3500)
    expect(tokens?.expires_in).toBeLessThanOrEqual(3600)
  })

  test("redirectToAuthorization invokes the onRedirect callback with the given URL", async () => {
    const auth = await getAuth()
    const { provider, redirects } = makeProvider(uniqueName("redir"), auth)
    const url = new URL("https://auth.example.com/authorize?client_id=abc")

    await provider.redirectToAuthorization(url)

    expect(redirects).toEqual([url])
  })

  test("codeVerifier throws when nothing was saved", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("verifier"), auth)
    await expect(provider.codeVerifier()).rejects.toThrow("No code verifier saved")
  })

  test("saveCodeVerifier persists, and codeVerifier reads it back", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("verifier"), auth)

    await provider.saveCodeVerifier("verifier-value")
    expect(await provider.codeVerifier()).toBe("verifier-value")
  })

  test("state generates and persists a new value when none exists", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("state"), auth)

    const state = await provider.state()
    expect(state).toMatch(/^[0-9a-f]{64}$/)
    // Calling state() again reads the same persisted value back, not a new one.
    expect(await provider.state()).toBe(state)
  })

  test("saveState persists an explicit value that state() then returns", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("state"), auth)

    await provider.saveState("explicit-state")
    expect(await provider.state()).toBe("explicit-state")
  })

  test("invalidateCredentials('all') removes the whole stored entry", async () => {
    const auth = await getAuth()
    const name = uniqueName("invalidate")
    const { provider } = makeProvider(name, auth)
    await provider.saveTokens({ access_token: "a", token_type: "Bearer" })

    await provider.invalidateCredentials("all")

    expect(await provider.tokens()).toBeUndefined()
  })

  test("invalidateCredentials('tokens') clears only the tokens", async () => {
    const auth = await getAuth()
    const name = uniqueName("invalidate")
    const { provider } = makeProvider(name, auth, { config: { clientId: "keep-me" } })
    await provider.saveTokens({ access_token: "a", token_type: "Bearer" })
    await provider.saveCodeVerifier("keep-verifier")

    await provider.invalidateCredentials("tokens")

    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.codeVerifier()).toBe("keep-verifier")
  })

  test("invalidateCredentials on a never-saved entry is a safe no-op", async () => {
    const auth = await getAuth()
    const { provider } = makeProvider(uniqueName("invalidate"), auth)
    await expect(provider.invalidateCredentials("all")).resolves.toBeUndefined()
  })
})

describe("mcp.parseRedirectUri", () => {
  test("returns the default port/path when no redirect URI is given", () => {
    expect(parseRedirectUri(undefined)).toEqual({ port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH })
  })

  test("extracts an explicit port and path", () => {
    expect(parseRedirectUri("http://localhost:5555/custom/callback")).toEqual({
      port: 5555,
      path: "/custom/callback",
    })
  })

  test("defaults to port 443 for https with no explicit port", () => {
    expect(parseRedirectUri("https://example.com/callback")).toEqual({ port: 443, path: "/callback" })
  })

  test("defaults to port 80 for http with no explicit port", () => {
    expect(parseRedirectUri("http://example.com/callback")).toEqual({ port: 80, path: "/callback" })
  })

  test("falls back to defaults for an unparseable URI", () => {
    expect(parseRedirectUri("not a url")).toEqual({ port: OAUTH_CALLBACK_PORT, path: OAUTH_CALLBACK_PATH })
  })
})
