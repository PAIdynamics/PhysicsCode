import { describe, expect, test } from "bun:test"
import { SessionScience } from "../../src/session/science"

describe("SessionScience", () => {
  test("pickSearchTool prefers the account science client and ignores other tools", () => {
    const tools = { other_science_search: 1, science_science_search: 2, science_science_status: 3, bash: 4 }
    expect(SessionScience.pickSearchTool(tools)).toEqual(["science_science_search", 2])
    expect(SessionScience.pickSearchTool({ local_science_search: 9 })).toEqual(["local_science_search", 9])
    expect(SessionScience.pickSearchTool({ bash: 1 })).toBeUndefined()
  })

  test("text() flattens MCP text content", () => {
    expect(
      SessionScience.text({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }),
    ).toBe("a\nb")
    expect(SessionScience.text(undefined)).toBe("")
    expect(SessionScience.text({ content: "nope" })).toBe("")
  })

  test("evidence() carries tool, query, body and truncates", () => {
    const out = SessionScience.evidence({
      tool: "science_science_search",
      query: "heat equation",
      text: "x".repeat(20_000),
    })
    expect(out).toContain("Tool: science_science_search")
    expect(out).toContain("Query: heat equation")
    expect(out).toContain("[truncated]")
    expect(out.length).toBeLessThan(SessionScience.MAX_CHARS + 1_000)
  })

  test("unavailable() tells the model to disclose the failure", () => {
    expect(SessionScience.unavailable("boom")).toContain("boom")
    expect(SessionScience.unavailable("boom")).toContain("Tell the user")
  })
})
