import { describe, expect, test } from "bun:test"
import { resolvePluginProviders } from "@/cli/cmd/providers"

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
