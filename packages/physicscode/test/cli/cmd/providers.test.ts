import { afterEach, describe, expect, test } from "bun:test"
import { handlePluginAuth, ProvidersLogoutCommand, resolvePluginProviders } from "@/cli/cmd/providers"
import { Auth } from "@/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { tmpdir } from "../../fixture/fixture"
import { CANCEL, clackMock, resetClackMock } from "../../lib/clack-mock"

function putAuth(key: string, info: Auth.Info) {
  return AppRuntime.runPromise(Auth.Service.use((svc) => svc.set(key, info)))
}

function removeAuth(key: string) {
  return AppRuntime.runPromise(Auth.Service.use((svc) => svc.remove(key)))
}

function hook(provider?: string) {
  return provider ? { auth: { provider, methods: [] } } : {}
}

describe("cli.cmd.providers.resolvePluginProviders", () => {
  test("returns an entry for a plugin hook with an auth provider", () => {
    const result = resolvePluginProviders({
      hooks: [hook("openai") as any],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "openai", name: "openai" }])
  })

  test("uses the provided display name when available", () => {
    const result = resolvePluginProviders({
      hooks: [hook("openai") as any],
      existingProviders: {},
      disabled: new Set(),
      providerNames: { openai: "OpenAI" },
    })
    expect(result).toEqual([{ id: "openai", name: "OpenAI" }])
  })

  test("skips hooks with no auth block", () => {
    const result = resolvePluginProviders({
      hooks: [hook() as any],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("dedupes hooks that share the same provider id", () => {
    const result = resolvePluginProviders({
      hooks: [hook("openai") as any, hook("openai") as any],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "openai", name: "openai" }])
  })

  test("skips providers that already exist", () => {
    const result = resolvePluginProviders({
      hooks: [hook("openai") as any],
      existingProviders: { openai: {} },
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("skips disabled providers", () => {
    const result = resolvePluginProviders({
      hooks: [hook("openai") as any],
      existingProviders: {},
      disabled: new Set(["openai"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("when an enabled set is given, only includes providers in it", () => {
    const result = resolvePluginProviders({
      hooks: [hook("openai") as any, hook("anthropic") as any],
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["anthropic"]),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "anthropic", name: "anthropic" }])
  })
})

// handlePluginAuth is the interactive glue that turns an auth method's
// result into a persisted credential - this is what actually runs when a
// user connects OpenAI/Anthropic via `providers login`. Only the
// non-interactive "auto" OAuth path (what both of codex.ts's OpenAI OAuth
// methods use) is exercised here: it never touches stdin, so it's testable
// without mocking @clack/prompts (which is used pervasively enough across
// the CLI that mocking it in one file risks leaking into unrelated tests
// in the same bun test process - see the mock.module leakage note
// elsewhere in this campaign). The "api"/prompts-driven branches always
// need a real interactive read and are left uncovered here.
describe("cli.cmd.providers.handlePluginAuth", () => {
  test("stores oauth credentials on a successful 'auto' authorize (single method, no prompts)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-oauth",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "auto" as const,
                  url: "https://example.com/authorize",
                  instructions: "Complete in browser",
                  callback: async () => ({
                    type: "success" as const,
                    refresh: "refresh-token",
                    access: "access-token",
                    expires: Date.now() + 3600_000,
                  }),
                }),
              },
            ],
          },
        }

        const handled = await handlePluginAuth(plugin as any, "test-oauth")
        expect(handled).toBe(true)

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-oauth")))
        expect(stored?.type).toBe("oauth")
        if (stored?.type === "oauth") {
          expect(stored.refresh).toBe("refresh-token")
          expect(stored.access).toBe("access-token")
        }
      },
    })
  })

  test("does not store credentials when the 'auto' authorize callback fails", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-oauth-fail",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "auto" as const,
                  url: "https://example.com/authorize",
                  instructions: "Complete in browser",
                  callback: async () => ({ type: "failed" as const }),
                }),
              },
            ],
          },
        }

        const handled = await handlePluginAuth(plugin as any, "test-oauth-fail")
        expect(handled).toBe(true)

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-oauth-fail")))
        expect(stored).toBeUndefined()
      },
    })
  })

  test("saves credentials under authorize's overridden provider id when given", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-oauth-override",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "auto" as const,
                  url: "https://example.com/authorize",
                  instructions: "Complete in browser",
                  callback: async () => ({
                    type: "success" as const,
                    provider: "test-oauth-override-actual",
                    refresh: "r",
                    access: "a",
                    expires: Date.now() + 1000,
                  }),
                }),
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-oauth-override")

        const original = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-oauth-override")))
        expect(original).toBeUndefined()
        const overridden = await AppRuntime.runPromise(
          Auth.Service.use((svc) => svc.get("test-oauth-override-actual")),
        )
        expect(overridden?.type).toBe("oauth")
      },
    })
  })

  test("exits with an error for an unknown --method name, without prompting", async () => {
    const originalExit = process.exit
    let exitCode: number | undefined
    process.exit = ((code?: number) => {
      exitCode = code
      throw new Error("process.exit called")
    }) as typeof process.exit

    try {
      const plugin = {
        auth: {
          provider: "test-unknown-method",
          methods: [{ label: "Real Method", type: "api" as const }],
        },
      }
      await expect(handlePluginAuth(plugin as any, "test-unknown-method", "not-a-real-method")).rejects.toThrow(
        "process.exit called",
      )
      expect(exitCode).toBe(1)
    } finally {
      process.exit = originalExit
    }
  })
})

// The "api" branch (and the method-selection prompt) always need a real
// interactive read, so these use the one shared, safe @clack/prompts mock
// (test/lib/clack-mock.ts) - it wraps the real module and only overrides
// select/password/isCancel, so it can't break other files' use of
// log.error, text, etc. the way an ad hoc per-file mock did before.
describe("cli.cmd.providers.handlePluginAuth (api-key branch)", () => {
  test("stores the entered API key when the method has no custom authorize", async () => {
    resetClackMock()
    clackMock.passwordResult = "sk-test-key"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-api-key",
            methods: [{ label: "Manually enter API Key", type: "api" as const }],
          },
        }

        const handled = await handlePluginAuth(plugin as any, "test-api-key")
        expect(handled).toBe(true)

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-api-key")))
        expect(stored?.type).toBe("api")
        if (stored?.type === "api") expect(stored.key).toBe("sk-test-key")
      },
    })
  })

  test("throws CancelledError when the API key prompt is cancelled", async () => {
    resetClackMock()
    clackMock.passwordResult = CANCEL

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-api-key-cancel",
            methods: [{ label: "Manually enter API Key", type: "api" as const }],
          },
        }

        let caught: unknown
        try {
          await handlePluginAuth(plugin as any, "test-api-key-cancel")
          expect.unreachable()
        } catch (e) {
          caught = e
        }
        expect((caught as Error).name).toBe("UICancelledError")

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-api-key-cancel")))
        expect(stored).toBeUndefined()
      },
    })
  })

  test("a custom authorize() can override both the key and the saved provider id", async () => {
    resetClackMock()
    clackMock.passwordResult = "sk-typed-key"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-api-authorize",
            methods: [
              {
                label: "Custom",
                type: "api" as const,
                authorize: async () => ({
                  type: "success" as const,
                  provider: "test-api-authorize-actual",
                  key: "sk-server-issued-key",
                }),
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-api-authorize")

        const original = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-api-authorize")))
        expect(original).toBeUndefined()
        const stored = await AppRuntime.runPromise(
          Auth.Service.use((svc) => svc.get("test-api-authorize-actual")),
        )
        expect(stored?.type).toBe("api")
        if (stored?.type === "api") expect(stored.key).toBe("sk-server-issued-key")
      },
    })
  })

  test("a failed custom authorize() persists nothing but still returns true", async () => {
    resetClackMock()
    clackMock.passwordResult = "sk-typed-key"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-api-authorize-fail",
            methods: [
              {
                label: "Custom",
                type: "api" as const,
                authorize: async () => ({ type: "failed" as const }),
              },
            ],
          },
        }

        const handled = await handlePluginAuth(plugin as any, "test-api-authorize-fail")
        expect(handled).toBe(true)

        const stored = await AppRuntime.runPromise(
          Auth.Service.use((svc) => svc.get("test-api-authorize-fail")),
        )
        expect(stored).toBeUndefined()
      },
    })
  })

  test("prompts for a method choice when there's more than one and no --method was given", async () => {
    resetClackMock()
    clackMock.selectResult = "1" // second method (0-indexed)
    clackMock.passwordResult = "sk-second-method-key"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-method-choice",
            methods: [
              { label: "First", type: "api" as const },
              { label: "Second", type: "api" as const },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-method-choice")

        expect(clackMock.calls.some((c) => c.fn === "select")).toBe(true)
        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-method-choice")))
        expect(stored?.type).toBe("api")
        if (stored?.type === "api") expect(stored.key).toBe("sk-second-method-key")
      },
    })
  })

  test("throws CancelledError when the method-choice prompt is cancelled", async () => {
    resetClackMock()
    clackMock.selectResult = CANCEL

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-method-choice-cancel",
            methods: [
              { label: "First", type: "api" as const },
              { label: "Second", type: "api" as const },
            ],
          },
        }

        let caught: unknown
        try {
          await handlePluginAuth(plugin as any, "test-method-choice-cancel")
          expect.unreachable()
        } catch (e) {
          caught = e
        }
        expect((caught as Error).name).toBe("UICancelledError")
      },
    })
  })
})

describe("cli.cmd.providers.handlePluginAuth (method.prompts loop)", () => {
  test("collects a select-type prompt answer and passes it to authorize()", async () => {
    resetClackMock()
    clackMock.selectResult = "enterprise"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let received: Record<string, string> | undefined
        const plugin = {
          auth: {
            provider: "test-prompts-select",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [{ type: "select" as const, key: "deploymentType", message: "Pick one", options: [] }],
                authorize: async (inputs: Record<string, string>) => {
                  received = inputs
                  return {
                    method: "auto" as const,
                    callback: async () => ({ type: "success" as const, refresh: "r", access: "a", expires: 0 }),
                  }
                },
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-prompts-select")
        expect(received).toEqual({ deploymentType: "enterprise" })
      },
    })
  })

  test("throws CancelledError when a select-type prompt is cancelled", async () => {
    resetClackMock()
    clackMock.selectResult = CANCEL

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-prompts-select-cancel",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [{ type: "select" as const, key: "deploymentType", message: "Pick one", options: [] }],
                authorize: async () => {
                  throw new Error("should not be reached")
                },
              },
            ],
          },
        }

        let caught: unknown
        try {
          await handlePluginAuth(plugin as any, "test-prompts-select-cancel")
          expect.unreachable()
        } catch (e) {
          caught = e
        }
        expect((caught as Error).name).toBe("UICancelledError")
      },
    })
  })

  test("collects a text-type prompt answer", async () => {
    resetClackMock()
    clackMock.textResult = "acme.ghe.com"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let received: Record<string, string> | undefined
        const plugin = {
          auth: {
            provider: "test-prompts-text",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [{ type: "text" as const, key: "enterpriseUrl", message: "Enter your domain" }],
                authorize: async (inputs: Record<string, string>) => {
                  received = inputs
                  return {
                    method: "auto" as const,
                    callback: async () => ({ type: "success" as const, refresh: "r", access: "a", expires: 0 }),
                  }
                },
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-prompts-text")
        expect(received).toEqual({ enterpriseUrl: "acme.ghe.com" })
      },
    })
  })

  test("throws CancelledError when a text-type prompt is cancelled", async () => {
    resetClackMock()
    clackMock.textResult = CANCEL

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-prompts-text-cancel",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [{ type: "text" as const, key: "enterpriseUrl", message: "Enter your domain" }],
                authorize: async () => {
                  throw new Error("should not be reached")
                },
              },
            ],
          },
        }

        let caught: unknown
        try {
          await handlePluginAuth(plugin as any, "test-prompts-text-cancel")
          expect.unreachable()
        } catch (e) {
          caught = e
        }
        expect((caught as Error).name).toBe("UICancelledError")
      },
    })
  })

  test("skips a later prompt whose `when` condition doesn't match", async () => {
    resetClackMock()
    clackMock.selectResult = "github.com"
    clackMock.textResult = "should-not-be-collected"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let received: Record<string, string> | undefined
        const plugin = {
          auth: {
            provider: "test-prompts-when-skip",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [
                  { type: "select" as const, key: "deploymentType", message: "Pick one", options: [] },
                  {
                    type: "text" as const,
                    key: "enterpriseUrl",
                    message: "Enter your domain",
                    when: { key: "deploymentType", op: "eq" as const, value: "enterprise" },
                  },
                ],
                authorize: async (inputs: Record<string, string>) => {
                  received = inputs
                  return {
                    method: "auto" as const,
                    callback: async () => ({ type: "success" as const, refresh: "r", access: "a", expires: 0 }),
                  }
                },
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-prompts-when-skip")
        expect(received).toEqual({ deploymentType: "github.com" })
        expect(clackMock.calls.filter((c) => c.fn === "text")).toHaveLength(0)
      },
    })
  })

  test("asks a later prompt whose `when` condition matches", async () => {
    resetClackMock()
    clackMock.selectResult = "enterprise"
    clackMock.textResult = "acme.ghe.com"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let received: Record<string, string> | undefined
        const plugin = {
          auth: {
            provider: "test-prompts-when-match",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [
                  { type: "select" as const, key: "deploymentType", message: "Pick one", options: [] },
                  {
                    type: "text" as const,
                    key: "enterpriseUrl",
                    message: "Enter your domain",
                    when: { key: "deploymentType", op: "eq" as const, value: "enterprise" },
                  },
                ],
                authorize: async (inputs: Record<string, string>) => {
                  received = inputs
                  return {
                    method: "auto" as const,
                    callback: async () => ({ type: "success" as const, refresh: "r", access: "a", expires: 0 }),
                  }
                },
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-prompts-when-match")
        expect(received).toEqual({ deploymentType: "enterprise", enterpriseUrl: "acme.ghe.com" })
      },
    })
  })

  test("respects a `when` op:'ne' (not-equal) condition", async () => {
    resetClackMock()
    clackMock.selectResult = "github.com"
    clackMock.textResult = "collected-because-not-enterprise"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let received: Record<string, string> | undefined
        const plugin = {
          auth: {
            provider: "test-prompts-when-ne",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [
                  { type: "select" as const, key: "deploymentType", message: "Pick one", options: [] },
                  {
                    type: "text" as const,
                    key: "notes",
                    message: "Anything else?",
                    when: { key: "deploymentType", op: "ne" as const, value: "enterprise" },
                  },
                ],
                authorize: async (inputs: Record<string, string>) => {
                  received = inputs
                  return {
                    method: "auto" as const,
                    callback: async () => ({ type: "success" as const, refresh: "r", access: "a", expires: 0 }),
                  }
                },
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-prompts-when-ne")
        expect(received).toEqual({ deploymentType: "github.com", notes: "collected-because-not-enterprise" })
      },
    })
  })

  test("skips a prompt whose custom `condition` returns false", async () => {
    resetClackMock()
    clackMock.textResult = "should-not-be-collected"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let received: Record<string, string> | undefined
        const plugin = {
          auth: {
            provider: "test-prompts-condition",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                prompts: [
                  {
                    type: "text" as const,
                    key: "notes",
                    message: "Anything else?",
                    condition: () => false,
                  },
                ],
                authorize: async (inputs: Record<string, string>) => {
                  received = inputs
                  return {
                    method: "auto" as const,
                    callback: async () => ({ type: "success" as const, refresh: "r", access: "a", expires: 0 }),
                  }
                },
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-prompts-condition")
        expect(received).toEqual({})
      },
    })
  })
})

describe("cli.cmd.providers.handlePluginAuth (oauth 'auto' with a key-style result)", () => {
  test("stores an api-type credential when the oauth callback returns 'key' instead of 'refresh'", async () => {
    resetClackMock()

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-oauth-key-result",
            methods: [
              {
                label: "Test OAuth",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "auto" as const,
                  callback: async () => ({ type: "success" as const, key: "sk-oauth-issued" }),
                }),
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-oauth-key-result")

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-oauth-key-result")))
        expect(stored?.type).toBe("api")
        if (stored?.type === "api") expect(stored.key).toBe("sk-oauth-issued")
      },
    })
  })
})

describe("cli.cmd.providers.handlePluginAuth (oauth 'code' method)", () => {
  test("prompts for a code, exchanges it, and stores oauth credentials", async () => {
    resetClackMock()
    clackMock.textResult = "pasted-auth-code"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let receivedCode: string | undefined
        const plugin = {
          auth: {
            provider: "test-oauth-code",
            methods: [
              {
                label: "Test OAuth (code)",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "code" as const,
                  url: "https://example.com/authorize",
                  callback: async (code: string) => {
                    receivedCode = code
                    return { type: "success" as const, refresh: "r-code", access: "a-code", expires: 0 }
                  },
                }),
              },
            ],
          },
        }

        const handled = await handlePluginAuth(plugin as any, "test-oauth-code")
        expect(handled).toBe(true)
        expect(receivedCode).toBe("pasted-auth-code")

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-oauth-code")))
        expect(stored?.type).toBe("oauth")
        if (stored?.type === "oauth") expect(stored.refresh).toBe("r-code")
      },
    })
  })

  test("stores an api-type credential when the code callback returns 'key' instead of 'refresh'", async () => {
    resetClackMock()
    clackMock.textResult = "pasted-auth-code"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-oauth-code-key",
            methods: [
              {
                label: "Test OAuth (code)",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "code" as const,
                  callback: async () => ({ type: "success" as const, key: "sk-code-issued" }),
                }),
              },
            ],
          },
        }

        await handlePluginAuth(plugin as any, "test-oauth-code-key")

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-oauth-code-key")))
        expect(stored?.type).toBe("api")
        if (stored?.type === "api") expect(stored.key).toBe("sk-code-issued")
      },
    })
  })

  test("does not store credentials when the code exchange fails", async () => {
    resetClackMock()
    clackMock.textResult = "bad-code"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-oauth-code-fail",
            methods: [
              {
                label: "Test OAuth (code)",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "code" as const,
                  callback: async () => ({ type: "failed" as const }),
                }),
              },
            ],
          },
        }

        const handled = await handlePluginAuth(plugin as any, "test-oauth-code-fail")
        expect(handled).toBe(true)

        const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-oauth-code-fail")))
        expect(stored).toBeUndefined()
      },
    })
  })

  test("throws CancelledError when the code prompt is cancelled", async () => {
    resetClackMock()
    clackMock.textResult = CANCEL

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugin = {
          auth: {
            provider: "test-oauth-code-cancel",
            methods: [
              {
                label: "Test OAuth (code)",
                type: "oauth" as const,
                authorize: async () => ({
                  method: "code" as const,
                  callback: async () => {
                    throw new Error("should not be reached")
                  },
                }),
              },
            ],
          },
        }

        let caught: unknown
        try {
          await handlePluginAuth(plugin as any, "test-oauth-code-cancel")
          expect.unreachable()
        } catch (e) {
          caught = e
        }
        expect((caught as Error).name).toBe("UICancelledError")
      },
    })
  })
})

describe("cli.cmd.providers.ProvidersLogoutCommand", () => {
  afterEach(() => {
    resetClackMock()
  })

  test("prints an error and exits early when there are no stored credentials", async () => {
    const all = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.all()))
    for (const key of Object.keys(all)) await removeAuth(key)
    resetClackMock()

    await ProvidersLogoutCommand.handler({} as any)

    // clack-mock only overrides log.info, not log.error - the "No
    // credentials found" message goes to the real clack log, so this
    // asserts the observable, trackable effect instead: the handler
    // returned before ever prompting for a provider to remove.
    expect(clackMock.calls.some((c) => c.fn === "select")).toBe(false)
  })

  test("removes the selected credential", async () => {
    await putAuth("logout-cmd-test", { type: "api", key: "sk-test" })
    resetClackMock()
    clackMock.selectResult = "logout-cmd-test"

    await ProvidersLogoutCommand.handler({} as any)

    const all = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.all()))
    expect(all["logout-cmd-test"]).toBeUndefined()
  })

  test("throws a cancellation error when the selection is cancelled", async () => {
    await putAuth("logout-cmd-test-2", { type: "api", key: "sk-test" })
    resetClackMock()
    clackMock.selectResult = CANCEL

    let caught: unknown
    try {
      await ProvidersLogoutCommand.handler({} as any)
      expect.unreachable()
    } catch (e) {
      caught = e
    }
    expect((caught as Error).name).toBe("UICancelledError")

    await removeAuth("logout-cmd-test-2")
  })
})
