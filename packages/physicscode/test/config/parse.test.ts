import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import z from "zod"
import { ConfigParse } from "@/config/parse"
import { InvalidError, JsonError } from "@/config/error"

describe("config.ConfigParse.jsonc", () => {
  test("parses valid JSON", () => {
    expect(ConfigParse.jsonc('{"a": 1, "b": "two"}', "test.json")).toEqual({ a: 1, b: "two" })
  })

  test("parses JSONC with comments and trailing commas", () => {
    const text = `{
      // a comment
      "a": 1,
      "b": 2,
    }`
    expect(ConfigParse.jsonc(text, "test.jsonc")).toEqual({ a: 1, b: 2 })
  })

  test("throws JsonError with line/column context for malformed JSON", () => {
    const text = `{\n  "a": ,\n}`
    expect(() => ConfigParse.jsonc(text, "bad.json")).toThrow(JsonError)
    try {
      ConfigParse.jsonc(text, "bad.json")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(JsonError)
      expect((e as InstanceType<typeof JsonError>).data.path).toBe("bad.json")
      expect((e as InstanceType<typeof JsonError>).data.message).toContain("line 2")
    }
  })
})

describe("config.ConfigParse.schema", () => {
  const Person = z.object({ name: z.string(), age: z.number() })

  test("returns parsed data when it matches the schema", () => {
    const result = ConfigParse.schema(Person, { name: "Ada", age: 30 }, "person.json")
    expect(result).toEqual({ name: "Ada", age: 30 })
  })

  test("throws InvalidError with the schema issues on mismatch", () => {
    try {
      ConfigParse.schema(Person, { name: "Ada", age: "thirty" }, "person.json")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidError)
      expect((e as InstanceType<typeof InvalidError>).data.path).toBe("person.json")
      expect((e as InstanceType<typeof InvalidError>).data.issues?.length).toBeGreaterThan(0)
    }
  })
})

describe("config.ConfigParse.effectSchema", () => {
  const PersonSchema = Schema.Struct({ name: Schema.String, age: Schema.Number })

  test("returns decoded data when it matches the schema", () => {
    const result = ConfigParse.effectSchema(PersonSchema, { name: "Ada", age: 30 }, "person.json")
    expect(result).toEqual({ name: "Ada", age: 30 })
  })

  test("throws InvalidError for unrecognized top-level keys", () => {
    try {
      ConfigParse.effectSchema(PersonSchema, { name: "Ada", age: 30, extra: "nope" }, "person.json")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidError)
      const issues = (e as InstanceType<typeof InvalidError>).data.issues ?? []
      expect(issues.some((i: any) => i.code === "unrecognized_keys")).toBe(true)
    }
  })

  test("throws InvalidError with formatted issues for a schema decode failure", () => {
    try {
      ConfigParse.effectSchema(PersonSchema, { name: "Ada", age: "thirty" }, "person.json")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidError)
      expect((e as InstanceType<typeof InvalidError>).data.path).toBe("person.json")
    }
  })

  test("does not flag extra keys for non-object data", () => {
    const StringSchema = Schema.String
    expect(ConfigParse.effectSchema(StringSchema, "hello", "str.json")).toBe("hello")
  })
})
