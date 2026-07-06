import { describe, expect, test } from "bun:test"
import { formatTerminalMath } from "./terminal-math"

describe("formatTerminalMath", () => {
  test("formats common inline and display math outside code blocks", () => {
    const input = [
      "Einstein wrote \\(E=mc^2\\).",
      "",
      "\\[\\frac{a}{b} + \\sqrt{x} \\le \\alpha\\]",
      "",
      "```tex",
      "\\frac{raw}{code}",
      "```",
    ].join("\n")

    expect(formatTerminalMath(input)).toContain("E=mc²")
    expect(formatTerminalMath(input)).toContain("(a)/(b) + √(x) ≤ α")
    expect(formatTerminalMath(input)).toContain("\\frac{raw}{code}")
  })
})
