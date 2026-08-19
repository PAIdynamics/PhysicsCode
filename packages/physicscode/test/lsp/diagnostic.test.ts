import { describe, expect, test } from "bun:test"
import { Diagnostic } from "@/lsp/diagnostic"
import type * as LSPClient from "@/lsp/client"

function diag(overrides: Partial<LSPClient.Diagnostic> = {}): LSPClient.Diagnostic {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message: "something went wrong",
    severity: 1,
    ...overrides,
  }
}

describe("lsp.Diagnostic.pretty", () => {
  test("formats an error with 1-indexed line/column", () => {
    const result = Diagnostic.pretty(
      diag({ severity: 1, message: "boom", range: { start: { line: 4, character: 9 }, end: { line: 4, character: 10 } } }),
    )
    expect(result).toBe("ERROR [5:10] boom")
  })

  test("formats a warning", () => {
    expect(Diagnostic.pretty(diag({ severity: 2, message: "warn" }))).toBe("WARN [1:1] warn")
  })

  test("formats info", () => {
    expect(Diagnostic.pretty(diag({ severity: 3, message: "info" }))).toBe("INFO [1:1] info")
  })

  test("formats a hint", () => {
    expect(Diagnostic.pretty(diag({ severity: 4, message: "hint" }))).toBe("HINT [1:1] hint")
  })

  test("defaults to ERROR when severity is missing", () => {
    expect(Diagnostic.pretty(diag({ severity: undefined, message: "unspecified" }))).toBe("ERROR [1:1] unspecified")
  })
})

describe("lsp.Diagnostic.report", () => {
  test("returns an empty string when there are no error-severity issues", () => {
    expect(Diagnostic.report("file.ts", [diag({ severity: 2 }), diag({ severity: 3 })])).toBe("")
  })

  test("returns an empty string for an empty issue list", () => {
    expect(Diagnostic.report("file.ts", [])).toBe("")
  })

  test("wraps error diagnostics in a <diagnostics> block", () => {
    const result = Diagnostic.report("file.ts", [diag({ severity: 1, message: "bad" })])
    expect(result).toContain('<diagnostics file="file.ts">')
    expect(result).toContain("ERROR [1:1] bad")
    expect(result).toContain("</diagnostics>")
  })

  test("ignores non-error diagnostics mixed in with errors", () => {
    const result = Diagnostic.report("file.ts", [diag({ severity: 1, message: "err" }), diag({ severity: 2, message: "warn" })])
    expect(result).toContain("err")
    expect(result).not.toContain("warn")
  })

  test("caps the number of reported errors and appends a count of the rest", () => {
    const issues = Array.from({ length: 25 }, (_, i) => diag({ severity: 1, message: `err${i}` }))
    const result = Diagnostic.report("file.ts", issues)
    expect(result).toContain("err0")
    expect(result).toContain("err19")
    expect(result).not.toContain("err20")
    expect(result).toContain("... and 5 more")
  })
})
