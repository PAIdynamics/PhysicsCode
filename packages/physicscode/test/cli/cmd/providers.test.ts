import { describe, expect, test } from "bun:test"
import { handlePluginAuth, resolvePluginProviders } from "@/cli/cmd/providers"
import { Auth } from "@/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { tmpdir } from "../../fixture/fixture"

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
