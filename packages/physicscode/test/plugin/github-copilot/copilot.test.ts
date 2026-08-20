import { describe, expect, test } from "bun:test"
import { CopilotAuthPlugin } from "@/plugin/github-copilot/copilot"
import type { PluginInput } from "@physicscode-ai/plugin"
import type { Hooks } from "@physicscode-ai/plugin"

type OAuthMethod = Extract<NonNullable<NonNullable<Hooks["auth"]>["methods"]>[number], { type: "oauth" }>

// The device-code method always returns `method: "auto"` (a zero-arg
// callback), but authorize()'s declared return type is a union that also
// covers a `method: "code"` (callback(code) required) shape - narrow at
// runtime so TypeScript knows which callback signature applies.
function autoCallback(result: Awaited<ReturnType<OAuthMethod["authorize"]>>) {
  if (result.method !== "auto") throw new Error("expected an 'auto' OAuth result")
  return result.callback()
}

function fakeModel(id: string) {
  return {
    id,
    api: { id, url: "https://original.example.com", npm: id.includes("claude") ? "@ai-sdk/anthropic" : "@ai-sdk/openai" },
  } as any
}

function fakeInput(overrides: Partial<PluginInput> = {}): PluginInput {
  return {
    client: {
      session: {
        message: async () => {
          throw new Error("not stubbed")
        },
        get: async () => {
          throw new Error("not stubbed")
        },
      },
    } as any,
    directory: "/tmp/project",
    ...overrides,
  } as PluginInput
}

function withFetch<T>(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, fn: () => Promise<T>) {
  const original = globalThis.fetch
  globalThis.fetch = handler as typeof fetch
  return fn().finally(() => {
    globalThis.fetch = original
  })
}

describe("plugin.github-copilot.copilot provider.models", () => {
  test("rewrites model URLs to the public API base when auth isn't oauth", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const models = await hooks.provider!.models!(
      { models: { "gpt-5.4": fakeModel("gpt-5.4") } } as any,
      { auth: undefined } as any,
    )
    expect(models["gpt-5.4"].api.url).toBe("https://api.githubcopilot.com")
    expect(models["gpt-5.4"].api.npm).toBe("@ai-sdk/github-copilot")
  })

  test("falls back to fix()'d models when the enterprise models endpoint fails", async () => {
    await withFetch(
      async () => new Response("server error", { status: 500 }),
      async () => {
        const hooks = await CopilotAuthPlugin(fakeInput())
        const models = await hooks.provider!.models!(
          { models: { "gpt-5.4": fakeModel("gpt-5.4") } } as any,
          { auth: { type: "oauth", refresh: "token", enterpriseUrl: "acme.ghe.com" } } as any,
        )
        expect(models["gpt-5.4"].api.url).toBe("https://copilot-api.acme.ghe.com")
      },
    )
  })
})

describe("plugin.github-copilot.copilot auth.loader", () => {
  test("returns an empty hook when there is no stored auth", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => undefined as any, {} as any)
    expect(loaded).toEqual({})
  })

  test("returns an empty hook when the stored auth isn't oauth", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "api" }) as any, {} as any)
    expect(loaded).toEqual({})
  })

  test("fetch() sets initiator=user and strips conflicting auth headers for a plain completions request", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "refresh-token" }) as any, {} as any)

    await withFetch(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers["x-initiator"]).toBe("user")
        expect(headers["Authorization"]).toBe("Bearer refresh-token")
        expect(headers["x-api-key"]).toBeUndefined()
        expect(headers["authorization"]).toBeUndefined()
        expect(headers["Copilot-Vision-Request"]).toBeUndefined()
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/chat/completions", {
          headers: { "x-api-key": "leaked", authorization: "leaked" },
          body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
        })
      },
    )
  })

  test("fetch() marks a non-user last completions message as agent-initiated", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "refresh-token" }) as any, {} as any)

    await withFetch(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers["x-initiator"]).toBe("agent")
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/chat/completions", {
          body: JSON.stringify({
            messages: [
              { role: "user", content: "hi" },
              { role: "assistant", content: "thinking" },
            ],
          }),
        })
      },
    )
  })

  test("fetch() detects vision content in a completions request", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "refresh-token" }) as any, {} as any)

    await withFetch(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers["Copilot-Vision-Request"]).toBe("true")
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/chat/completions", {
          body: JSON.stringify({
            messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }],
          }),
        })
      },
    )
  })

  test("fetch() detects vision content in a Responses API request", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "refresh-token" }) as any, {} as any)

    await withFetch(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers["Copilot-Vision-Request"]).toBe("true")
        expect(headers["x-initiator"]).toBe("user")
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/responses", {
          body: JSON.stringify({
            input: [{ role: "user", content: [{ type: "input_image", image_url: "x" }] }],
          }),
        })
      },
    )
  })

  test("fetch() treats a tool_result-only last message as agent-initiated in the Messages API shape", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "refresh-token" }) as any, {} as any)

    await withFetch(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers["x-initiator"]).toBe("agent")
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/v1/messages", {
          body: JSON.stringify({
            messages: [{ role: "user", content: [{ type: "tool_result", content: [] }] }],
          }),
        })
      },
    )
  })

  test("fetch() detects vision nested inside a tool_result in the Messages API shape", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "refresh-token" }) as any, {} as any)

    await withFetch(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers["Copilot-Vision-Request"]).toBe("true")
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/v1/messages", {
          body: JSON.stringify({
            messages: [
              { role: "user", content: [{ type: "tool_result", content: [{ type: "image" }] }] },
            ],
          }),
        })
      },
    )
  })

  test("fetch() falls through to plain fetch when the refreshed auth isn't oauth", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    let calls = 0
    const loaded = await hooks.auth!.loader!(async () => {
      calls++
      return calls === 1 ? ({ type: "oauth", refresh: "refresh-token" } as any) : ({ type: "api" } as any)
    }, {} as any)

    await withFetch(
      async (_input, init) => {
        // plain fetch() passthrough - no x-initiator/Authorization rewriting
        expect((init?.headers as Record<string, string> | undefined)?.["x-initiator"]).toBeUndefined()
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/chat/completions", {})
      },
    )
  })

  test("fetch() tolerates a non-JSON body without throwing", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", refresh: "refresh-token" }) as any, {} as any)

    await withFetch(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>
        expect(headers["x-initiator"]).toBe("user")
        return new Response("ok")
      },
      async () => {
        await loaded.fetch!("https://api.githubcopilot.com/chat/completions", { body: "not json" })
      },
    )
  })
})

describe("plugin.github-copilot.copilot auth.methods[0] device-code authorize()", () => {
  async function method() {
    const hooks = await CopilotAuthPlugin(fakeInput())
    return hooks.auth!.methods![0] as OAuthMethod
  }

  test("throws when device-code initiation fails", async () => {
    await withFetch(
      async () => new Response("error", { status: 500 }),
      async () => {
        const m = await method()
        await expect(m.authorize!({})).rejects.toThrow("Failed to initiate device authorization")
      },
    )
  })

  test("uses github.com by default and returns verification instructions", async () => {
    await withFetch(
      async (input) => {
        const url = input.toString()
        expect(url).toBe("https://github.com/login/device/code")
        return Response.json({ verification_uri: "https://github.com/login/device", user_code: "AAAA-1111", device_code: "dev-1", interval: 0 })
      },
      async () => {
        const m = await method()
        const result = await m.authorize!({})
        expect(result.method).toBe("auto")
        expect(result.instructions).toContain("AAAA-1111")
        expect(result.url).toBe("https://github.com/login/device")
      },
    )
  })

  test("normalizes an enterprise URL into a copilot-api domain and includes it on success", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes("/login/device/code")) {
        expect(url).toBe("https://acme.ghe.com/login/device/code")
        return Response.json({ verification_uri: "https://acme.ghe.com/login/device", user_code: "BBBB-2222", device_code: "dev-2", interval: 0 })
      }
      if (url.includes("/login/oauth/access_token")) {
        return Response.json({ access_token: "tok-1" })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const m = await method()
      const result = await m.authorize!({ deploymentType: "enterprise", enterpriseUrl: "https://acme.ghe.com" })
      const outcome = await autoCallback(result)
      expect(outcome).toEqual({
        type: "success",
        refresh: "tok-1",
        access: "tok-1",
        expires: 0,
        enterpriseUrl: "acme.ghe.com",
      })
    } finally {
      globalThis.fetch = original
    }
  })

  test("callback() succeeds immediately when the first poll returns a token", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes("/login/device/code")) {
        return Response.json({ verification_uri: "https://github.com/login/device", user_code: "CCCC-3333", device_code: "dev-3", interval: 0 })
      }
      if (url.includes("/login/oauth/access_token")) {
        return Response.json({ access_token: "tok-2" })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const m = await method()
      const result = await m.authorize!({})
      const outcome = await autoCallback(result)
      expect(outcome).toEqual({ type: "success", refresh: "tok-2", access: "tok-2", expires: 0 })
    } finally {
      globalThis.fetch = original
    }
  })

  test("callback() returns failed when the token poll HTTP request itself fails", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes("/login/device/code")) {
        return Response.json({ verification_uri: "https://github.com/login/device", user_code: "DDDD-4444", device_code: "dev-4", interval: 0 })
      }
      if (url.includes("/login/oauth/access_token")) {
        return new Response("error", { status: 500 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const m = await method()
      const result = await m.authorize!({})
      expect(await autoCallback(result)).toEqual({ type: "failed" })
    } finally {
      globalThis.fetch = original
    }
  })

  test("callback() returns failed on a terminal OAuth error", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes("/login/device/code")) {
        return Response.json({ verification_uri: "https://github.com/login/device", user_code: "EEEE-5555", device_code: "dev-5", interval: 0 })
      }
      if (url.includes("/login/oauth/access_token")) {
        return Response.json({ error: "access_denied" })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const m = await method()
      const result = await m.authorize!({})
      expect(await autoCallback(result)).toEqual({ type: "failed" })
    } finally {
      globalThis.fetch = original
    }
  })

  test("callback() retries on authorization_pending and then succeeds", async () => {
    const original = globalThis.fetch
    let polls = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes("/login/device/code")) {
        return Response.json({ verification_uri: "https://github.com/login/device", user_code: "FFFF-6666", device_code: "dev-6", interval: 0 })
      }
      if (url.includes("/login/oauth/access_token")) {
        polls++
        if (polls === 1) return Response.json({ error: "authorization_pending" })
        return Response.json({ access_token: "tok-3" })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const m = await method()
      const result = await m.authorize!({})
      const outcome = await autoCallback(result)
      expect(outcome).toEqual({ type: "success", refresh: "tok-3", access: "tok-3", expires: 0 })
      expect(polls).toBe(2)
    } finally {
      globalThis.fetch = original
    }
    // interval:0 + the fixed 3s safety margin still applies per retry
  }, 15000)
})

describe("plugin.github-copilot.copilot chat.params", () => {
  test("skips non-copilot models entirely", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const output = { maxOutputTokens: 123, options: {} as Record<string, unknown> }
    await hooks["chat.params"]!(
      { model: { providerID: "anthropic", api: { id: "claude", npm: "@ai-sdk/anthropic" } } } as any,
      output as any,
    )
    expect(output.maxOutputTokens).toBe(123)
  })

  test("omits maxOutputTokens for gpt models on github-copilot", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const output = { maxOutputTokens: 123, options: {} as Record<string, unknown> }
    await hooks["chat.params"]!(
      { model: { providerID: "github-copilot", api: { id: "gpt-5.4", npm: "@ai-sdk/github-copilot" } } } as any,
      output as any,
    )
    expect(output.maxOutputTokens).toBeUndefined()
  })

  test("disables tool streaming for anthropic-backed copilot models", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const output = { options: {} as Record<string, unknown> }
    await hooks["chat.params"]!(
      { model: { providerID: "github-copilot", api: { id: "claude", npm: "@ai-sdk/anthropic" } } } as any,
      output as any,
    )
    expect(output.options.toolStreaming).toBe(false)
  })
})

describe("plugin.github-copilot.copilot chat.headers", () => {
  test("skips non-copilot models entirely", async () => {
    const hooks = await CopilotAuthPlugin(fakeInput())
    const output = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!({ model: { providerID: "anthropic", api: {} } } as any, output as any)
    expect(output.headers).toEqual({})
  })

  test("adds the anthropic-beta header for anthropic-backed copilot models", async () => {
    const hooks = await CopilotAuthPlugin(
      fakeInput({
        client: {
          session: {
            message: async () => ({ data: { parts: [] } }),
            get: async () => ({ data: { parentID: undefined } }),
          },
        } as any,
      }),
    )
    const output = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!(
      {
        model: { providerID: "github-copilot", api: { npm: "@ai-sdk/anthropic" } },
        message: { sessionID: "s1", id: "m1" },
        sessionID: "s1",
      } as any,
      output as any,
    )
    expect(output.headers["anthropic-beta"]).toBe("interleaved-thinking-2025-05-14")
  })

  test("marks the request agent-initiated when the session has a compaction part", async () => {
    const hooks = await CopilotAuthPlugin(
      fakeInput({
        client: {
          session: {
            message: async () => ({ data: { parts: [{ type: "compaction" }] } }),
            get: async () => {
              throw new Error("should not be called once compaction short-circuits")
            },
          },
        } as any,
      }),
    )
    const output = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!(
      {
        model: { providerID: "github-copilot", api: {} },
        message: { sessionID: "s1", id: "m1" },
        sessionID: "s1",
      } as any,
      output as any,
    )
    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("marks the request agent-initiated for a synthetic compaction-continue text part", async () => {
    const hooks = await CopilotAuthPlugin(
      fakeInput({
        client: {
          session: {
            message: async () => ({
              data: { parts: [{ type: "text", synthetic: true, metadata: { compaction_continue: true } }] },
            }),
            get: async () => {
              throw new Error("should not be called")
            },
          },
        } as any,
      }),
    )
    const output = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!(
      {
        model: { providerID: "github-copilot", api: {} },
        message: { sessionID: "s1", id: "m1" },
        sessionID: "s1",
      } as any,
      output as any,
    )
    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("marks the request agent-initiated for a subagent session (has a parentID)", async () => {
    const hooks = await CopilotAuthPlugin(
      fakeInput({
        client: {
          session: {
            message: async () => ({ data: { parts: [] } }),
            get: async () => ({ data: { parentID: "parent-session" } }),
          },
        } as any,
      }),
    )
    const output = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!(
      {
        model: { providerID: "github-copilot", api: {} },
        message: { sessionID: "s1", id: "m1" },
        sessionID: "s1",
      } as any,
      output as any,
    )
    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("leaves x-initiator unset for a top-level, non-compaction session", async () => {
    const hooks = await CopilotAuthPlugin(
      fakeInput({
        client: {
          session: {
            message: async () => ({ data: { parts: [] } }),
            get: async () => ({ data: { parentID: undefined } }),
          },
        } as any,
      }),
    )
    const output = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!(
      {
        model: { providerID: "github-copilot", api: {} },
        message: { sessionID: "s1", id: "m1" },
        sessionID: "s1",
      } as any,
      output as any,
    )
    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("tolerates the session lookups throwing (network errors)", async () => {
    const hooks = await CopilotAuthPlugin(
      fakeInput({
        client: {
          session: {
            message: async () => {
              throw new Error("network down")
            },
            get: async () => {
              throw new Error("network down")
            },
          },
        } as any,
      }),
    )
    const output = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!(
      {
        model: { providerID: "github-copilot", api: {} },
        message: { sessionID: "s1", id: "m1" },
        sessionID: "s1",
      } as any,
      output as any,
    )
    expect(output.headers["x-initiator"]).toBeUndefined()
  })
})
