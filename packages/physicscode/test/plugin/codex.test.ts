import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@physicscode-ai/plugin"
import {
  CodexAuthPlugin,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  stopOAuthServer,
  type IdTokenClaims,
} from "../../src/plugin/codex"

// The browser-OAuth methods below don't read `input` at all, so a stub is
// enough - only its shape needs to satisfy PluginInput.
const fakeInput = {} as PluginInput

type Hooks = Awaited<ReturnType<typeof CodexAuthPlugin>>
type AuthMethods = NonNullable<NonNullable<Hooks["auth"]>["methods"]>
type OAuthMethod = Extract<AuthMethods[number], { type: "oauth" }>

// Both codex.ts OAuth methods always return `method: "auto"`; this just
// narrows the union so `.callback()` can be called with zero arguments.
// A no-op .catch() is pre-attached because the real localhost HTTP
// round-trip these tests drive afterward creates a genuine multi-tick gap
// before the caller gets around to asserting on the (possibly-rejected)
// promise, which bun's runtime otherwise flags as an unhandled rejection.
function autoCallback(result: Awaited<ReturnType<OAuthMethod["authorize"]>>) {
  if (result.method !== "auto") throw new Error("expected an 'auto' OAuth result")
  const promise = result.callback()
  promise.catch(() => {})
  return promise
}

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })
})

describe("plugin.codex CodexAuthPlugin auth methods", () => {
  test("exposes exactly the three documented OpenAI connection methods", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const methods = hooks.auth?.methods ?? []
    expect(methods.map((m) => m.label)).toEqual([
      "ChatGPT Pro/Plus (browser)",
      "ChatGPT Pro/Plus (headless)",
      "Manually enter API Key",
    ])
    expect(methods.map((m) => m.type)).toEqual(["oauth", "oauth", "api"])
    expect(hooks.auth?.provider).toBe("openai")
  })
})

// The device-auth-server portion of the browser flow is real (a live
// http.createServer on the hardcoded OAuth redirect port), so these drive
// it with real HTTP requests rather than mocking it. Only the *token
// exchange* against auth.openai.com itself is out of scope here (it would
// require hitting the real network) - every failure branch below rejects
// before token exchange is ever attempted, so it's fully exercisable.
describe("plugin.codex browser OAuth flow", () => {
  afterEach(() => {
    stopOAuthServer()
  })

  test("authorize() returns a ChatGPT authorize URL with PKCE params and starts the callback server", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()

    expect(result.method).toBe("auto")
    expect(result.url.startsWith("https://auth.openai.com/oauth/authorize?")).toBe(true)
    expect(result.url).toContain("code_challenge_method=S256")
    expect(result.url).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann")
    expect(result.instructions).toContain("browser")
  })

  test("rejects with the provider's error when the callback receives ?error=", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()
    const callback = autoCallback(result)

    const res = await fetch("http://localhost:1455/auth/callback?error=access_denied&error_description=User+denied+access")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("User denied access")

    await expect(callback).rejects.toThrow("User denied access")
  })

  test("rejects when the callback is missing an authorization code", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()
    const callback = autoCallback(result)

    const res = await fetch("http://localhost:1455/auth/callback")
    expect(res.status).toBe(400)

    await expect(callback).rejects.toThrow("Missing authorization code")
  })

  test("rejects on a state mismatch (CSRF protection)", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()
    const callback = autoCallback(result)

    const res = await fetch("http://localhost:1455/auth/callback?code=abc123&state=not-the-real-state")
    expect(res.status).toBe(400)

    await expect(callback).rejects.toThrow("Invalid state - potential CSRF attack")
  })

  test("/cancel rejects the pending authorization", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()
    const callback = autoCallback(result)

    const res = await fetch("http://localhost:1455/cancel")
    expect(res.status).toBe(200)

    await expect(callback).rejects.toThrow("Login cancelled")
  })

  test("returns 404 for unrelated paths on the local callback server", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    await method.authorize()

    const res = await fetch("http://localhost:1455/some/other/path")
    expect(res.status).toBe(404)
  })
})

// The headless (device-code) flow has no local server component - every
// step is a direct fetch() to auth.openai.com, so these stub globalThis.fetch
// for the duration of a single call and restore it immediately in finally,
// scoped tightly around the awaited call so it can't leak into other tests.
describe("plugin.codex headless (device-code) OAuth flow", () => {
  function fakeJwt(claims: Record<string, unknown>) {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url")
    return `${header}.${body}.sig`
  }

  test("throws when the device-auth initiation request fails", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/api/accounts/deviceauth/usercode")) {
        return new Response("server error", { status: 500 })
      }
      throw new Error(`unexpected fetch in test: ${url}`)
    }) as typeof fetch

    try {
      const hooks = await CodexAuthPlugin(fakeInput)
      const method = hooks.auth!.methods[1] as OAuthMethod
      await expect(method.authorize()).rejects.toThrow("Failed to initiate device authorization")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("returns the user code and completes on the first successful poll", async () => {
    const originalFetch = globalThis.fetch
    const idToken = fakeJwt({ chatgpt_account_id: "acc-device-flow" })
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/api/accounts/deviceauth/usercode")) {
        return Response.json({ device_auth_id: "device-1", user_code: "ABCD-1234", interval: "1" })
      }
      if (url.includes("/api/accounts/deviceauth/token")) {
        return Response.json({ authorization_code: "auth-code-1", code_verifier: "verifier-1" })
      }
      if (url.includes("/oauth/token")) {
        return Response.json({
          id_token: idToken,
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
        })
      }
      throw new Error(`unexpected fetch in test: ${url}`)
    }) as typeof fetch

    try {
      const hooks = await CodexAuthPlugin(fakeInput)
      const method = hooks.auth!.methods[1] as OAuthMethod
      const result = await method.authorize()
      expect(result.instructions).toContain("ABCD-1234")

      const outcome = await autoCallback(result)
      expect(outcome.type).toBe("success")
      if (outcome.type === "success" && "refresh" in outcome) {
        expect(outcome.refresh).toBe("refresh-1")
        expect(outcome.access).toBe("access-1")
        expect(outcome.accountId).toBe("acc-device-flow")
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("returns a failed result when the token exchange step fails", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/api/accounts/deviceauth/usercode")) {
        return Response.json({ device_auth_id: "device-1", user_code: "ABCD-1234", interval: "1" })
      }
      if (url.includes("/api/accounts/deviceauth/token")) {
        // Neither ok, nor a 403/404 "still pending" status - the polling
        // loop treats this as a hard failure.
        return new Response("gone", { status: 410 })
      }
      throw new Error(`unexpected fetch in test: ${url}`)
    }) as typeof fetch

    try {
      const hooks = await CodexAuthPlugin(fakeInput)
      const method = hooks.auth!.methods[1] as OAuthMethod
      const result = await method.authorize()
      const outcome = await autoCallback(result)
      expect(outcome.type).toBe("failed")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// The auth.loader().fetch wrapper is what every actual OpenAI request goes
// through once a user is connected via OAuth - it injects the bearer
// token, refreshes it when expired, and rewrites the URL to the Codex
// backend. This is the piece that keeps a browser/device login "just
// working" across a session, so its refresh behavior (including failure)
// is worth covering directly rather than trusting it as untested glue.
describe("plugin.codex OAuth loader (per-request auth wrapper)", () => {
  function fakeJwt(claims: Record<string, unknown>) {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url")
    return `${header}.${body}.sig`
  }

  function fakeClient(onSet: (body: unknown) => void) {
    return {
      auth: {
        set: async (args: { path: { id: string }; body: unknown }) => {
          onSet(args.body)
        },
      },
    } as unknown as PluginInput["client"]
  }

  test("loader returns an empty hook when the stored auth isn't oauth", async () => {
    const hooks = await CodexAuthPlugin(fakeInput)
    const result = await hooks.auth!.loader!(async () => ({ type: "api", key: "sk-x" }) as any, {} as any)
    expect(result).toEqual({})
  })

  test("fetch() uses the current access token without refreshing when it isn't expired", async () => {
    const originalFetch = globalThis.fetch
    let capturedRequest: { url: string; headers: Record<string, string> } | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = {
        url: typeof input === "string" ? input : input.toString(),
        headers: init?.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : {},
      }
      return new Response("ok")
    }) as typeof fetch

    try {
      const hooks = await CodexAuthPlugin({ ...fakeInput, client: fakeClient(() => {}) })
      const currentAuth = {
        type: "oauth" as const,
        refresh: "refresh-current",
        access: "access-current",
        expires: Date.now() + 3600_000,
        accountId: "acc-current",
      }
      const loaded = await hooks.auth!.loader!(async () => currentAuth as any, {} as any)
      expect(loaded.apiKey).toBeTruthy()

      await loaded.fetch("https://api.openai.com/v1/responses", { method: "POST" })

      expect(capturedRequest?.url).toBe("https://chatgpt.com/backend-api/codex/responses")
      expect(capturedRequest?.headers.authorization).toBe("Bearer access-current")
      expect(capturedRequest?.headers["chatgpt-account-id"]).toBe("acc-current")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetch() passes through unrelated URLs without rewriting them to the Codex endpoint", async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl: string | undefined
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString()
      return new Response("ok")
    }) as typeof fetch

    try {
      const hooks = await CodexAuthPlugin({ ...fakeInput, client: fakeClient(() => {}) })
      const currentAuth = {
        type: "oauth" as const,
        refresh: "refresh-current",
        access: "access-current",
        expires: Date.now() + 3600_000,
      }
      const loaded = await hooks.auth!.loader!(async () => currentAuth as any, {} as any)
      await loaded.fetch("https://api.openai.com/v1/models", { method: "GET" })
      expect(capturedUrl).toBe("https://api.openai.com/v1/models")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetch() refreshes an expired token, persists it, and uses the new access token", async () => {
    const originalFetch = globalThis.fetch
    const idToken = fakeJwt({ chatgpt_account_id: "acc-refreshed" })
    let capturedRequest: { url: string; headers: Record<string, string> } | undefined
    let persisted: any

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "https://auth.openai.com/oauth/token") {
        return Response.json({
          id_token: idToken,
          access_token: "access-refreshed",
          refresh_token: "refresh-refreshed",
          expires_in: 3600,
        })
      }
      capturedRequest = {
        url,
        headers: init?.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : {},
      }
      return new Response("ok")
    }) as typeof fetch

    try {
      const hooks = await CodexAuthPlugin({
        ...fakeInput,
        client: fakeClient((body) => {
          persisted = body
        }),
      })
      const currentAuth = {
        type: "oauth" as const,
        refresh: "refresh-old",
        access: "access-old",
        expires: Date.now() - 1000, // already expired
      }
      const loaded = await hooks.auth!.loader!(async () => currentAuth as any, {} as any)
      await loaded.fetch("https://api.openai.com/v1/responses", { method: "POST" })

      expect(capturedRequest?.headers.authorization).toBe("Bearer access-refreshed")
      expect(persisted).toMatchObject({
        type: "oauth",
        refresh: "refresh-refreshed",
        access: "access-refreshed",
        accountId: "acc-refreshed",
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetch() rejects when the token-refresh request itself fails", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === "https://auth.openai.com/oauth/token") {
        return new Response("server error", { status: 500 })
      }
      throw new Error(`unexpected fetch in test: ${url}`)
    }) as typeof fetch

    try {
      const hooks = await CodexAuthPlugin({ ...fakeInput, client: fakeClient(() => {}) })
      const currentAuth = {
        type: "oauth" as const,
        refresh: "refresh-old",
        access: "access-old",
        expires: Date.now() - 1000,
      }
      const loaded = await hooks.auth!.loader!(async () => currentAuth as any, {} as any)
      await expect(loaded.fetch("https://api.openai.com/v1/responses", { method: "POST" })).rejects.toThrow(
        "Token refresh failed",
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
