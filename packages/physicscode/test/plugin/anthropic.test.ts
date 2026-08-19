import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@physicscode-ai/plugin"
import {
  AnthropicAuthPlugin,
  buildAuthorizeUrl,
  createApiKey,
  ExchangeFailedError,
  exchangeCode,
  refreshAccessToken,
} from "../../src/plugin/anthropic"

// AnthropicAuthPlugin's methods don't read `input` at all except via
// input.client.auth.set (only exercised in the loader tests below), so a
// stub is enough for the other tests - only its shape needs to satisfy
// PluginInput.
const fakeInput = {} as PluginInput

type Hooks = Awaited<ReturnType<typeof AnthropicAuthPlugin>>
type AuthMethods = NonNullable<NonNullable<Hooks["auth"]>["methods"]>
type OAuthMethod = Extract<AuthMethods[number], { type: "oauth" }>

function codeCallback(result: Awaited<ReturnType<OAuthMethod["authorize"]>>) {
  if (result.method !== "code") throw new Error("expected a 'code' OAuth result")
  return result.callback
}

function withFetch<T>(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, fn: () => Promise<T>) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = handler as typeof fetch
  return fn().finally(() => {
    globalThis.fetch = originalFetch
  })
}

describe("plugin.anthropic.buildAuthorizeUrl", () => {
  test("builds a claude.ai authorize URL for 'max' mode", async () => {
    const { url, verifier } = await buildAuthorizeUrl("max")
    expect(url.startsWith("https://claude.ai/oauth/authorize?")).toBe(true)
    expect(url).toContain("client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e")
    expect(url).toContain("code_challenge_method=S256")
    expect(new URL(url).searchParams.get("state")).toBe(verifier)
    expect(verifier.length).toBeGreaterThan(0)
  })

  test("builds a console.anthropic.com authorize URL for 'console' mode", async () => {
    const { url } = await buildAuthorizeUrl("console")
    expect(url.startsWith("https://console.anthropic.com/oauth/authorize?")).toBe(true)
  })

  test("generates a fresh verifier on every call", async () => {
    const a = await buildAuthorizeUrl("max")
    const b = await buildAuthorizeUrl("max")
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe("plugin.anthropic.exchangeCode", () => {
  test("splits the pasted 'code#state' and posts the token request", async () => {
    let captured: Record<string, unknown> | undefined
    const result = await withFetch(
      async (_input, init) => {
        captured = JSON.parse(init!.body as string)
        return Response.json({ refresh_token: "r1", access_token: "a1", expires_in: 3600 })
      },
      () => exchangeCode("the-code#the-state", "the-verifier"),
    )
    expect(captured?.code).toBe("the-code")
    expect(captured?.state).toBe("the-state")
    expect(captured?.code_verifier).toBe("the-verifier")
    expect(captured?.grant_type).toBe("authorization_code")
    expect(result.refresh).toBe("r1")
    expect(result.access).toBe("a1")
    expect(result.expires).toBeGreaterThan(Date.now())
  })

  test("falls back to the verifier as state when the pasted code has no '#'", async () => {
    let captured: Record<string, unknown> | undefined
    await withFetch(
      async (_input, init) => {
        captured = JSON.parse(init!.body as string)
        return Response.json({ refresh_token: "r1", access_token: "a1", expires_in: 3600 })
      },
      () => exchangeCode("just-a-code", "fallback-verifier"),
    )
    expect(captured?.code).toBe("just-a-code")
    expect(captured?.state).toBe("fallback-verifier")
  })

  test("throws ExchangeFailedError when the token endpoint rejects", async () => {
    await expect(
      withFetch(
        async () => new Response("bad code", { status: 400 }),
        () => exchangeCode("bad-code", "verifier"),
      ),
    ).rejects.toBeInstanceOf(ExchangeFailedError)
  })
})

describe("plugin.anthropic.refreshAccessToken", () => {
  test("posts a refresh_token grant and returns new tokens", async () => {
    let captured: Record<string, unknown> | undefined
    const result = await withFetch(
      async (_input, init) => {
        captured = JSON.parse(init!.body as string)
        return Response.json({ refresh_token: "r2", access_token: "a2", expires_in: 3600 })
      },
      () => refreshAccessToken("old-refresh"),
    )
    expect(captured?.grant_type).toBe("refresh_token")
    expect(captured?.refresh_token).toBe("old-refresh")
    expect(result.access).toBe("a2")
  })

  test("throws when the refresh request fails", async () => {
    await expect(
      withFetch(
        async () => new Response("server error", { status: 500 }),
        () => refreshAccessToken("old-refresh"),
      ),
    ).rejects.toThrow("Token refresh failed")
  })
})

describe("plugin.anthropic.createApiKey", () => {
  test("posts the access token and returns the minted key", async () => {
    let capturedAuth: string | undefined
    const key = await withFetch(
      async (_input, init) => {
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization
        return Response.json({ raw_key: "sk-ant-minted-key" })
      },
      () => createApiKey("access-token-1"),
    )
    expect(capturedAuth).toBe("Bearer access-token-1")
    expect(key).toBe("sk-ant-minted-key")
  })

  test("throws when the create-api-key request fails", async () => {
    await expect(
      withFetch(
        async () => new Response("forbidden", { status: 403 }),
        () => createApiKey("access-token-1"),
      ),
    ).rejects.toThrow("Failed to create API key")
  })
})

describe("plugin.anthropic AnthropicAuthPlugin auth methods", () => {
  test("exposes exactly the three connection methods", async () => {
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const methods = hooks.auth?.methods ?? []
    expect(methods.map((m) => m.label)).toEqual(["Claude Pro/Max", "Create API Key", "Manually enter API Key"])
    expect(methods.map((m) => m.type)).toEqual(["oauth", "oauth", "api"])
    expect(hooks.auth?.provider).toBe("anthropic")
  })
})

describe("plugin.anthropic 'Claude Pro/Max' OAuth method", () => {
  test("authorize() returns a claude.ai URL with method 'code'", async () => {
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()
    expect(result.method).toBe("code")
    expect(result.url).toContain("claude.ai/oauth/authorize")
    expect(result.instructions).toContain("paste")
  })

  test("callback() exchanges the pasted code and returns oauth tokens on success", async () => {
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()
    const callback = codeCallback(result)

    const outcome = await withFetch(
      async () => Response.json({ refresh_token: "r-max", access_token: "a-max", expires_in: 3600 }),
      () => callback("code#state"),
    )

    expect(outcome.type).toBe("success")
    if (outcome.type === "success" && "refresh" in outcome) {
      expect(outcome.refresh).toBe("r-max")
      expect(outcome.access).toBe("a-max")
    }
  })

  test("callback() returns 'failed' when the exchange is rejected", async () => {
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[0] as OAuthMethod
    const result = await method.authorize()
    const callback = codeCallback(result)

    const outcome = await withFetch(
      async () => new Response("bad code", { status: 400 }),
      () => callback("bad-code#state"),
    )
    expect(outcome.type).toBe("failed")
  })
})

describe("plugin.anthropic 'Create API Key' OAuth method", () => {
  test("authorize() returns a console.anthropic.com URL with method 'code'", async () => {
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[1] as OAuthMethod
    const result = await method.authorize()
    expect(result.method).toBe("code")
    expect(result.url).toContain("console.anthropic.com/oauth/authorize")
  })

  test("callback() exchanges the code, mints an API key, and returns it", async () => {
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[1] as OAuthMethod
    const result = await method.authorize()
    const callback = codeCallback(result)

    const outcome = await withFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/v1/oauth/token")) {
        return Response.json({ refresh_token: "r-console", access_token: "a-console", expires_in: 3600 })
      }
      if (url.includes("/create_api_key")) {
        return Response.json({ raw_key: "sk-ant-console-key" })
      }
      throw new Error(`unexpected fetch in test: ${url}`)
    }, () => callback("code#state"))

    expect(outcome.type).toBe("success")
    if (outcome.type === "success" && "key" in outcome) {
      expect(outcome.key).toBe("sk-ant-console-key")
    }
  })

  test("callback() returns 'failed' when API-key creation fails after a successful exchange", async () => {
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const method = hooks.auth!.methods[1] as OAuthMethod
    const result = await method.authorize()
    const callback = codeCallback(result)

    const outcome = await withFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/v1/oauth/token")) {
        return Response.json({ refresh_token: "r-console", access_token: "a-console", expires_in: 3600 })
      }
      return new Response("forbidden", { status: 403 })
    }, () => callback("code#state"))

    expect(outcome.type).toBe("failed")
  })
})

describe("plugin.anthropic OAuth loader (per-request auth wrapper)", () => {
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
    const hooks = await AnthropicAuthPlugin(fakeInput)
    const result = await hooks.auth!.loader!(async () => ({ type: "api", key: "sk-x" }) as any, {} as any)
    expect(result).toEqual({})
  })

  test("fetch() attaches the bearer token and anthropic-beta header without refreshing when not expired", async () => {
    let captured: { url: string; headers: Record<string, string> } | undefined
    const outcome = await withFetch(
      async (input, init) => {
        captured = {
          url: typeof input === "string" ? input : input.toString(),
          headers: init?.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : {},
        }
        return new Response("ok")
      },
      async () => {
        const hooks = await AnthropicAuthPlugin({ ...fakeInput, client: fakeClient(() => {}) })
        const currentAuth = {
          type: "oauth" as const,
          refresh: "refresh-current",
          access: "access-current",
          expires: Date.now() + 3600_000,
        }
        const loaded = await hooks.auth!.loader!(async () => currentAuth as any, {} as any)
        await loaded.fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": "should-be-removed" },
        })
        return true
      },
    )
    expect(outcome).toBe(true)
    expect(captured?.url).toBe("https://api.anthropic.com/v1/messages")
    expect(captured?.headers.authorization).toBe("Bearer access-current")
    expect(captured?.headers["anthropic-beta"]).toContain("oauth-2025-04-20")
    expect(captured?.headers["x-api-key"]).toBeUndefined()
  })

  test("fetch() refreshes an expired token, persists it, and uses the new access token", async () => {
    let persisted: any
    let capturedAuthHeader: string | undefined
    const outcome = await withFetch(
      async (input, init) => {
        const url = typeof input === "string" ? input : input.toString()
        if (url === "https://console.anthropic.com/v1/oauth/token") {
          return Response.json({ refresh_token: "refresh-new", access_token: "access-new", expires_in: 3600 })
        }
        capturedAuthHeader =
          init?.headers instanceof Headers ? (init.headers.get("authorization") ?? undefined) : undefined
        return new Response("ok")
      },
      async () => {
        const hooks = await AnthropicAuthPlugin({
          ...fakeInput,
          client: fakeClient((body) => {
            persisted = body
          }),
        })
        const currentAuth = {
          type: "oauth" as const,
          refresh: "refresh-old",
          access: "access-old",
          expires: Date.now() - 1000,
        }
        const loaded = await hooks.auth!.loader!(async () => currentAuth as any, {} as any)
        await loaded.fetch("https://api.anthropic.com/v1/messages", { method: "POST" })
        return true
      },
    )
    expect(outcome).toBe(true)
    expect(capturedAuthHeader).toBe("Bearer access-new")
    expect(persisted).toMatchObject({ type: "oauth", refresh: "refresh-new", access: "access-new" })
  })

  test("fetch() rejects when the token-refresh request itself fails", async () => {
    await expect(
      withFetch(
        async (input) => {
          const url = typeof input === "string" ? input : input.toString()
          if (url === "https://console.anthropic.com/v1/oauth/token") {
            return new Response("server error", { status: 500 })
          }
          throw new Error(`unexpected fetch in test: ${url}`)
        },
        async () => {
          const hooks = await AnthropicAuthPlugin({ ...fakeInput, client: fakeClient(() => {}) })
          const currentAuth = {
            type: "oauth" as const,
            refresh: "refresh-old",
            access: "access-old",
            expires: Date.now() - 1000,
          }
          const loaded = await hooks.auth!.loader!(async () => currentAuth as any, {} as any)
          return loaded.fetch("https://api.anthropic.com/v1/messages", { method: "POST" })
        },
      ),
    ).rejects.toThrow("Token refresh failed")
  })
})
