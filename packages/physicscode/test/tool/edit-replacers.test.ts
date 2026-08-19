import { describe, expect, test } from "bun:test"
import {
  BlockAnchorReplacer,
  ContextAwareReplacer,
  EscapeNormalizedReplacer,
  IndentationFlexibleReplacer,
  LineTrimmedReplacer,
  MultiOccurrenceReplacer,
  SimpleReplacer,
  TrimmedBoundaryReplacer,
  WhitespaceNormalizedReplacer,
  replace,
  trimDiff,
} from "@/tool/edit"

function all(gen: Generator<string, void, unknown>): string[] {
  return [...gen]
}

describe("tool.edit.SimpleReplacer", () => {
  test("always yields the find string unchanged", () => {
    expect(all(SimpleReplacer("anything", "needle"))).toEqual(["needle"])
  })
})

describe("tool.edit.LineTrimmedReplacer", () => {
  test("matches lines ignoring leading/trailing whitespace", () => {
    const content = "function foo() {\n    return 1;\n}"
    const find = "  return 1;  "
    expect(all(LineTrimmedReplacer(content, find))).toEqual(["    return 1;"])
  })

  test("matches a multi-line block ignoring per-line whitespace", () => {
    const content = "a\n  b  \n c \nd"
    const find = "b\nc"
    expect(all(LineTrimmedReplacer(content, find))).toEqual(["  b  \n c "])
  })

  test("drops a trailing empty search line before matching", () => {
    const content = "a\nb\nc"
    const find = "a\nb\n"
    expect(all(LineTrimmedReplacer(content, find))).toEqual(["a\nb"])
  })

  test("yields nothing when no line matches", () => {
    expect(all(LineTrimmedReplacer("a\nb\nc", "x"))).toEqual([])
  })
})

describe("tool.edit.BlockAnchorReplacer", () => {
  test("returns nothing for fewer than 3 search lines", () => {
    expect(all(BlockAnchorReplacer("a\nb\nc", "a\nb"))).toEqual([])
  })

  test("matches via first/last line anchors with a single candidate", () => {
    const content = "function foo() {\n  doSomethingElse();\n}"
    const find = "function foo() {\n  doSomething();\n}"
    expect(all(BlockAnchorReplacer(content, find))).toEqual([content])
  })

  test("returns nothing when no candidate anchors match", () => {
    expect(all(BlockAnchorReplacer("a\nb\nc\nd", "x\ny\nz"))).toEqual([])
  })

  test("picks the most similar candidate among multiple anchor matches", () => {
    const content = ["start", "close enough middle", "end", "middle", "start", "totally different", "end"].join("\n")
    const find = "start\nclose enough diddle\nend"
    const [result] = all(BlockAnchorReplacer(content, find))
    expect(result).toBe("start\nclose enough middle\nend")
  })

  test("rejects all candidates when similarity is below the multi-candidate threshold", () => {
    const content = ["start", "aaaaaaaaaa", "end", "start", "zzzzzzzzzz", "end"].join("\n")
    const find = "start\nbbbbbbbbbb\nend"
    expect(all(BlockAnchorReplacer(content, find))).toEqual([])
  })
})

describe("tool.edit.WhitespaceNormalizedReplacer", () => {
  test("matches a full line with different internal whitespace", () => {
    const content = "const  x   =  1;\nother"
    const find = "const x = 1;"
    expect(all(WhitespaceNormalizedReplacer(content, find))).toContain("const  x   =  1;")
  })

  test("matches a substring within a line via word-boundary regex", () => {
    const content = "prefix const   x = 1; suffix"
    const find = "const x = 1;"
    const results = all(WhitespaceNormalizedReplacer(content, find))
    expect(results.some((r) => r.includes("const   x = 1;"))).toBe(true)
  })

  test("matches a multi-line block ignoring whitespace differences", () => {
    const content = "a\nconst   x  =  1;\nconst y = 2;\nb"
    const find = "const x = 1;\nconst y = 2;"
    const results = all(WhitespaceNormalizedReplacer(content, find))
    expect(results).toContain("const   x  =  1;\nconst y = 2;")
  })
})

describe("tool.edit.IndentationFlexibleReplacer", () => {
  test("matches a block with uniformly different indentation", () => {
    const content = "if (x) {\n    doA();\n    doB();\n}"
    const find = "doA();\ndoB();"
    expect(all(IndentationFlexibleReplacer(content, find))).toEqual(["    doA();\n    doB();"])
  })

  test("yields nothing when relative indentation differs", () => {
    const content = "  doA();\n      doB();"
    const find = "doA();\ndoB();"
    expect(all(IndentationFlexibleReplacer(content, find))).toEqual([])
  })
})

describe("tool.edit.EscapeNormalizedReplacer", () => {
  test("matches content directly against an unescaped find string", () => {
    const content = "line one\nline two"
    const find = "line one\\nline two"
    expect(all(EscapeNormalizedReplacer(content, find))).toContain("line one\nline two")
  })

  test("matches an escaped block in content against an unescaped find", () => {
    // Content and find must have the same number of "\n"-split lines for the
    // block-matching loop to run at all, so use a tab (not a line break) as
    // the escape sequence under test.
    const content = "hello\\tworld"
    const find = "hello\tworld"
    expect(all(EscapeNormalizedReplacer(content, find))).toContain("hello\\tworld")
  })
})

describe("tool.edit.MultiOccurrenceReplacer", () => {
  test("yields every occurrence of an exact match", () => {
    const content = "foo bar foo baz foo"
    expect(all(MultiOccurrenceReplacer(content, "foo"))).toEqual(["foo", "foo", "foo"])
  })

  test("yields nothing when there is no match", () => {
    expect(all(MultiOccurrenceReplacer("abc", "xyz"))).toEqual([])
  })
})

describe("tool.edit.TrimmedBoundaryReplacer", () => {
  test("returns nothing when the find string is already trimmed", () => {
    expect(all(TrimmedBoundaryReplacer("abc", "abc"))).toEqual([])
  })

  test("matches content against a trimmed find with surrounding whitespace", () => {
    const content = "prefix abc suffix"
    expect(all(TrimmedBoundaryReplacer(content, "  abc  "))).toContain("abc")
  })
})

describe("tool.edit.ContextAwareReplacer", () => {
  test("returns nothing for fewer than 3 find lines", () => {
    expect(all(ContextAwareReplacer("a\nb", "a\nb"))).toEqual([])
  })

  test("matches a block where at least half the middle lines match", () => {
    const content = "start\nsame\ndifferent-in-content\nend"
    const find = "start\nsame\ndifferent-in-find\nend"
    expect(all(ContextAwareReplacer(content, find))).toEqual([content])
  })

  test("rejects a block where too few middle lines match", () => {
    const content = "start\nxxxx\nyyyy\nzzzz\nend"
    const find = "start\naaaa\nbbbb\ncccc\nend"
    expect(all(ContextAwareReplacer(content, find))).toEqual([])
  })
})

describe("tool.edit.trimDiff", () => {
  test("strips common leading indentation from +/-/context lines", () => {
    const diff = ["@@ -1,2 +1,2 @@", "-    old line", "+    new line", "     context line"].join("\n")
    const result = trimDiff(diff)
    expect(result).toContain("-old line")
    expect(result).toContain("+new line")
    expect(result).toContain(" context line")
  })

  test("leaves the diff unchanged when there is no common indentation", () => {
    const diff = ["@@ -1,1 +1,1 @@", "-old", "+new"].join("\n")
    expect(trimDiff(diff)).toBe(diff)
  })

  test("leaves the diff unchanged when there are no content lines", () => {
    const diff = "--- a\n+++ b"
    expect(trimDiff(diff)).toBe(diff)
  })
})

describe("tool.edit.replace", () => {
  test("replaces an exact match", () => {
    expect(replace("hello world", "world", "there")).toBe("hello there")
  })

  test("throws when oldString equals newString", () => {
    expect(() => replace("hello", "hello", "hello")).toThrow("identical")
  })

  test("throws when oldString is not found", () => {
    expect(() => replace("hello", "missing", "x")).toThrow("Could not find oldString")
  })

  test("throws on multiple matches without replaceAll", () => {
    expect(() => replace("foo foo", "foo", "bar")).toThrow("multiple matches")
  })

  test("replaceAll replaces every occurrence", () => {
    expect(replace("foo foo foo", "foo", "bar", true)).toBe("bar bar bar")
  })

  test("falls back to a fuzzy replacer when the exact string isn't present", () => {
    const content = "function foo() {\n    return 1;\n}"
    const result = replace(content, "  return 1;  ", "  return 2;  ")
    expect(result).toContain("return 2;")
    expect(result).not.toContain("return 1;")
  })
})
