import { describe, expect, test } from "bun:test"
import { EOL } from "os"
import { UI } from "@/cli/ui"

function captureStderr() {
  const writes: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: any) => {
    writes.push(chunk.toString())
    return true
  }) as typeof process.stderr.write
  return {
    writes,
    restore: () => {
      process.stderr.write = original
    },
  }
}

describe("cli.UI.print / println", () => {
  test("print writes the joined message without a trailing newline", () => {
    const capture = captureStderr()
    try {
      UI.print("hello", "world")
      expect(capture.writes).toEqual(["hello world"])
    } finally {
      capture.restore()
    }
  })

  test("println writes the joined message followed by EOL", () => {
    const capture = captureStderr()
    try {
      UI.println("hello", "world")
      expect(capture.writes).toEqual(["hello world", EOL])
    } finally {
      capture.restore()
    }
  })
})

describe("cli.UI.empty", () => {
  test("writes a blank line the first time, then does nothing until output resumes", () => {
    // Force `blank` to a known false state first.
    const setup = captureStderr()
    UI.print("reset")
    setup.restore()

    const capture = captureStderr()
    try {
      UI.empty()
      expect(capture.writes.length).toBeGreaterThan(0)

      capture.writes.length = 0
      UI.empty()
      expect(capture.writes).toEqual([])

      // Printing something resets the blank flag, so empty() writes again.
      UI.print("x")
      capture.writes.length = 0
      UI.empty()
      expect(capture.writes.length).toBeGreaterThan(0)
    } finally {
      capture.restore()
    }
  })
})

describe("cli.UI.error", () => {
  test("prefixes the message with a styled 'Error: '", () => {
    const capture = captureStderr()
    try {
      UI.error("something broke")
      const combined = capture.writes.join("")
      expect(combined).toContain("Error: ")
      expect(combined).toContain("something broke")
    } finally {
      capture.restore()
    }
  })

  test("strips a redundant leading 'Error: ' before re-adding the styled prefix", () => {
    const capture = captureStderr()
    try {
      UI.error("Error: already prefixed")
      const combined = capture.writes.join("")
      // Only one "Error: " should remain (the styled one this function adds).
      expect(combined.match(/Error: /g)?.length).toBe(1)
      expect(combined).toContain("already prefixed")
    } finally {
      capture.restore()
    }
  })
})

describe("cli.UI.logo", () => {
  test("returns the plain wordmark when neither stdout nor stderr is a TTY", () => {
    // bun test runs with no TTY attached, so this exercises the non-TTY path.
    expect(process.stdout.isTTY).toBeFalsy()
    expect(process.stderr.isTTY).toBeFalsy()
    expect(UI.logo()).toBe("PhysicsCode")
  })

  test("prefixes each line with the given pad", () => {
    expect(UI.logo("  ")).toBe("  PhysicsCode")
  })
})

describe("cli.UI.markdown", () => {
  test("returns the input text unchanged", () => {
    expect(UI.markdown("# Title\n\nSome **bold** text")).toBe("# Title\n\nSome **bold** text")
  })

  test("passes through an empty string", () => {
    expect(UI.markdown("")).toBe("")
  })
})
