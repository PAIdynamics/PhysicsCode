import { describe, expect, test } from "bun:test"
import { QuestionID } from "@/question/schema"

describe("question.schema.QuestionID", () => {
  test("ascending() generates an id prefixed with 'que'", () => {
    expect((QuestionID.ascending() as unknown as string).startsWith("que")).toBe(true)
  })

  test("ascending() generates unique, monotonically increasing ids", () => {
    const a = QuestionID.ascending()
    const b = QuestionID.ascending()
    expect(a).not.toBe(b)
    expect(a < b).toBe(true)
  })

  test("ascending() accepts an existing id", () => {
    const given = QuestionID.ascending()
    expect(QuestionID.ascending(given as unknown as string)).toBe(given)
  })

  test("exposes a zod schema that parses a generated id", () => {
    const id = QuestionID.ascending()
    expect(QuestionID.zod.parse(id)).toBe(id)
  })
})
