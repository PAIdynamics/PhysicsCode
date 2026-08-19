import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { fn } from "@/util/fn"

describe("util.fn", () => {
  const schema = z.object({ name: z.string(), age: z.number() })

  test("parses the input with the schema before calling the callback", () => {
    const greet = fn(schema, (input) => `${input.name} is ${input.age}`)
    expect(greet({ name: "Ada", age: 30 })).toBe("Ada is 30")
  })

  test("throws the ZodError when the input fails validation", () => {
    const greet = fn(schema, (input) => `${input.name} is ${input.age}`)
    expect(() => greet({ name: "Ada", age: "thirty" } as any)).toThrow(z.ZodError)
  })

  test("force() calls the callback without schema validation", () => {
    const greet = fn(schema, (input) => `${input.name} is ${input.age}`)
    // Bypasses validation entirely - an invalid shape is passed straight through.
    expect(greet.force({ name: "Ada", age: "not a number" } as any)).toBe("Ada is not a number")
  })

  test("exposes the original schema", () => {
    const greet = fn(schema, (input) => input.name)
    expect(greet.schema).toBe(schema)
  })

  test("strips unknown keys per the schema's default parse behavior", () => {
    const greet = fn(schema, (input) => input)
    const result = greet({ name: "Ada", age: 30, extra: "dropped" } as any)
    expect(result).toEqual({ name: "Ada", age: 30 })
  })
})
