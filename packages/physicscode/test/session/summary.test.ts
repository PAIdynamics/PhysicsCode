import { describe, expect, test } from "bun:test"
import { SessionSummary } from "@/session/summary"

describe("session.SessionSummary.unquoteGitPath", () => {
  test("returns the input unchanged when it isn't quoted", () => {
    expect(SessionSummary.unquoteGitPath("src/index.ts")).toBe("src/index.ts")
  })

  test("returns the input unchanged when only the leading quote is present", () => {
    expect(SessionSummary.unquoteGitPath('"unterminated')).toBe('"unterminated')
  })

  test("strips the surrounding quotes with no escapes", () => {
    expect(SessionSummary.unquoteGitPath('"hello.txt"')).toBe("hello.txt")
  })

  test("unescapes C-style control character sequences", () => {
    expect(SessionSummary.unquoteGitPath('"a\\tb"')).toBe("a\tb")
    expect(SessionSummary.unquoteGitPath('"a\\nb"')).toBe("a\nb")
    expect(SessionSummary.unquoteGitPath('"a\\rb"')).toBe("a\rb")
  })

  test("unescapes a literal backslash and a literal quote", () => {
    expect(SessionSummary.unquoteGitPath('"a\\\\b"')).toBe("a\\b")
    expect(SessionSummary.unquoteGitPath('"a\\"b"')).toBe('a"b')
  })

  test("decodes octal byte escapes as UTF-8 (e.g. accented characters)", () => {
    // "café" - the é is UTF-8 bytes 0xC3 0xA9, which git renders as \303\251.
    expect(SessionSummary.unquoteGitPath('"caf\\303\\251"')).toBe("café")
  })

  test("handles a partial octal escape at the end of the string", () => {
    // \7 alone (a single valid octal digit, nothing more available to consume).
    expect(SessionSummary.unquoteGitPath('"a\\7"')).toBe("a" + String.fromCharCode(7))
  })

  test("keeps the literal digit when the escape isn't a recognized sequence", () => {
    // \8 - 8 isn't an octal digit (0-7) and isn't a named C escape, so the
    // backslash is dropped and the digit itself is kept.
    expect(SessionSummary.unquoteGitPath('"a\\8b"')).toBe("a8b")
  })

  test("keeps a trailing lone backslash with nothing after it", () => {
    expect(SessionSummary.unquoteGitPath('"a\\"')).toBe("a\\")
  })

  test("passes through an already-empty quoted string", () => {
    expect(SessionSummary.unquoteGitPath('""')).toBe("")
  })
})
