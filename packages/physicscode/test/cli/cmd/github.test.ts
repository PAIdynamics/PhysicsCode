import { describe, expect, test } from "bun:test"
import { extractResponseText, formatPromptTooLargeError, parseGitHubRemote } from "@/cli/cmd/github"
import type { MessageV2 } from "@/session/message-v2"

describe("cli.cmd.github.parseGitHubRemote", () => {
  test("parses an https URL with .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/PAIdynamics/PhysicsCode.git")).toEqual({
      owner: "PAIdynamics",
      repo: "PhysicsCode",
    })
  })

  test("parses an https URL without .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/PAIdynamics/PhysicsCode")).toEqual({
      owner: "PAIdynamics",
      repo: "PhysicsCode",
    })
  })

  test("parses an http URL", () => {
    expect(parseGitHubRemote("http://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" })
  })

  test("parses an scp-style git@ URL with .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:owner/repo.git")).toEqual({ owner: "owner", repo: "repo" })
  })

  test("parses an scp-style git@ URL without .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:owner/repo")).toEqual({ owner: "owner", repo: "repo" })
  })

  test("parses an ssh:// URL with .git suffix", () => {
    expect(parseGitHubRemote("ssh://git@github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" })
  })

  test("parses an ssh:// URL without .git suffix", () => {
    expect(parseGitHubRemote("ssh://git@github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" })
  })

  test("returns null for a non-GitHub URL", () => {
    expect(parseGitHubRemote("https://gitlab.com/owner/repo.git")).toBeNull()
  })

  test("returns null for a malformed URL", () => {
    expect(parseGitHubRemote("not a url")).toBeNull()
  })

  test("returns null when the path has more than owner/repo segments", () => {
    expect(parseGitHubRemote("https://github.com/owner/repo/extra")).toBeNull()
  })
})

describe("cli.cmd.github.extractResponseText", () => {
  test("returns the text of the last text part", () => {
    const parts = [
      { type: "text", text: "first" },
      { type: "text", text: "last" },
    ] as unknown as MessageV2.Part[]
    expect(extractResponseText(parts)).toBe("last")
  })

  test("returns the last text part even when non-text parts follow earlier text parts", () => {
    const parts = [
      { type: "text", text: "kept" },
      { type: "tool", tool: "bash" },
    ] as unknown as MessageV2.Part[]
    expect(extractResponseText(parts)).toBe("kept")
  })

  test("returns null when there are only non-text parts", () => {
    const parts = [{ type: "tool", tool: "bash" }, { type: "step-start" }] as unknown as MessageV2.Part[]
    expect(extractResponseText(parts)).toBeNull()
  })

  test("throws when there are no parts at all", () => {
    expect(() => extractResponseText([])).toThrow("Failed to parse response: no parts returned")
  })
})

describe("cli.cmd.github.formatPromptTooLargeError", () => {
  test("includes file names and sizes computed from base64 content length", () => {
    const message = formatPromptTooLargeError([{ filename: "big.png", content: "a".repeat(1024) }])
    expect(message).toContain("PROMPT_TOO_LARGE")
    expect(message).toContain("big.png")
    // 1024 base64 chars * 0.75 / 1024 KB = 0.75 KB, rounds to "1"
    expect(message).toContain("(1 KB)")
  })

  test("lists multiple files", () => {
    const message = formatPromptTooLargeError([
      { filename: "a.txt", content: "" },
      { filename: "b.txt", content: "" },
    ])
    expect(message).toContain("a.txt")
    expect(message).toContain("b.txt")
  })

  test("omits the file list section when there are no files", () => {
    const message = formatPromptTooLargeError([])
    expect(message).toBe("PROMPT_TOO_LARGE: The prompt exceeds the model's context limit.")
    expect(message).not.toContain("Files in prompt")
  })
})
