import { describe, expect, test } from "bun:test"
import { handlePluginAuth, resolvePluginProviders } from "@/cli/cmd/providers"
import { Auth } from "@/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { tmpdir } from "../../fixture/fixture"
import { CANCEL, clackMock, resetClackMock } from "../../lib/clack-mock"

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
