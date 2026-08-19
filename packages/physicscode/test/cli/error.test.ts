import { describe, expect, test } from "bun:test"
import { FormatError, FormatUnknownError } from "@/cli/error"

describe("cli.FormatError", () => {
  test("formats MCPFailed with the server name", () => {
    const result = FormatError({ name: "MCPFailed", data: { name: "my-server" } })
    expect(result).toBe(
      `MCP server "my-server" failed. Note, physicscode does not support MCP authentication yet.`,
    )
  })

  test("formats AccountServiceError using its message", () => {
    const result = FormatError({ _tag: "AccountServiceError", message: "account service down" })
    expect(result).toBe("account service down")
  })

  test("formats AccountTransportError using its message", () => {
    const result = FormatError({ _tag: "AccountTransportError", message: "network unreachable" })
    expect(result).toBe("network unreachable")
  })

  test("falls back to empty string when a tagged account error has no message", () => {
    const result = FormatError({ _tag: "AccountServiceError" })
    expect(result).toBe("")
  })

  test("formats ProviderModelNotFoundError with suggestions", () => {
    const result = FormatError({
      name: "ProviderModelNotFoundError",
      data: { providerID: "openai", modelID: "gpt-9", suggestions: ["gpt-4o", "gpt-4o-mini"] },
    })
    expect(result).toBe(
      [
        "Model not found: openai/gpt-9",
        "Did you mean: gpt-4o, gpt-4o-mini",
        "Try: `physicscode models` to list available models",
        "Or check your config (physicscode.json) provider/model names",
      ].join("\n"),
    )
  })

  test("formats ProviderModelNotFoundError without suggestions", () => {
    const result = FormatError({
      name: "ProviderModelNotFoundError",
      data: { providerID: "openai", modelID: "gpt-9" },
    })
    expect(result).toBe(
      [
        "Model not found: openai/gpt-9",
        "Try: `physicscode models` to list available models",
        "Or check your config (physicscode.json) provider/model names",
      ].join("\n"),
    )
  })

  test("formats ProviderInitError with the provider id", () => {
    const result = FormatError({ name: "ProviderInitError", data: { providerID: "anthropic" } })
    expect(result).toBe(`Failed to initialize provider "anthropic". Check credentials and configuration.`)
  })

  test("formats ConfigJsonError with a message", () => {
    const result = FormatError({ name: "ConfigJsonError", data: { path: "/repo/physicscode.json", message: "Unexpected token" } })
    expect(result).toBe("Config file at /repo/physicscode.json is not valid JSON(C): Unexpected token")
  })

  test("formats ConfigJsonError without a message", () => {
    const result = FormatError({ name: "ConfigJsonError", data: { path: "/repo/physicscode.json" } })
    expect(result).toBe("Config file at /repo/physicscode.json is not valid JSON(C)")
  })

  test("formats ConfigDirectoryTypoError", () => {
    const result = FormatError({
      name: "ConfigDirectoryTypoError",
      data: { dir: ".Physicscode", path: "/repo", suggestion: ".physicscode" },
    })
    expect(result).toBe(
      `Directory ".Physicscode" in /repo is not valid. Rename the directory to ".physicscode" or remove it. This is a common typo.`,
    )
  })

  test("formats ConfigFrontmatterError using its data message", () => {
    const result = FormatError({ name: "ConfigFrontmatterError", data: { message: "bad frontmatter" } })
    expect(result).toBe("bad frontmatter")
  })

  test("formats ConfigInvalidError with path, message, and issues", () => {
    const result = FormatError({
      name: "ConfigInvalidError",
      data: {
        path: "provider.openai",
        message: "invalid shape",
        issues: [{ message: "must be a string", path: ["apiKey"] }],
      },
    })
    expect(result).toBe(
      ["Configuration is invalid at provider.openai: invalid shape", "↳ must be a string apiKey"].join("\n"),
    )
  })

  test("omits the path suffix for ConfigInvalidError when path is the sentinel 'config'", () => {
    const result = FormatError({ name: "ConfigInvalidError", data: { path: "config", message: "bad" } })
    expect(result).toBe("Configuration is invalid: bad")
  })

  test("formats ConfigInvalidError with no message and no issues", () => {
    const result = FormatError({ name: "ConfigInvalidError", data: {} })
    expect(result).toBe("Configuration is invalid")
  })

  test("returns an empty string for UICancelledError", () => {
    expect(FormatError({ name: "UICancelledError" })).toBe("")
  })

  test("returns undefined for an unrecognized error", () => {
    expect(FormatError({ name: "SomeOtherError" })).toBeUndefined()
    expect(FormatError(new Error("plain"))).toBeUndefined()
    expect(FormatError("just a string")).toBeUndefined()
    expect(FormatError(null)).toBeUndefined()
  })
})

describe("cli.FormatUnknownError", () => {
  test("uses the error's stack when available", () => {
    const err = new Error("boom")
    expect(FormatUnknownError(err)).toBe(err.stack!)
  })

  test("falls back to name: message when there's no stack", () => {
    const err = new Error("boom")
    err.stack = undefined
    expect(FormatUnknownError(err)).toBe("Error: boom")
  })

  test("JSON-stringifies plain objects", () => {
    expect(FormatUnknownError({ code: "EFAIL" })).toBe(JSON.stringify({ code: "EFAIL" }, null, 2))
  })

  test("stringifies primitives", () => {
    expect(FormatUnknownError("just a string")).toBe("just a string")
    expect(FormatUnknownError(42)).toBe("42")
    expect(FormatUnknownError(null)).toBe("null")
  })
})
