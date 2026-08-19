import { describe, expect, test } from "bun:test"
import { errorData, errorFormat, errorMessage } from "../../src/util/error"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")

    const data = errorData(err)
    expect(data.type).toBe("Error")
    expect(data.message).toBe("boom")
    expect(String(data.formatted)).toContain("boom")
  })

  test("extracts message from record-like values", () => {
    const err = { message: "bad input", code: "E_BAD" }
    expect(errorMessage(err)).toBe("bad input")

    const data = errorData(err)
    expect(data.message).toBe("bad input")
    expect(data.code).toBe("E_BAD")
  })

  test("handles opaque throwables with custom toString", () => {
    const err = {
      toString() {
        return "ResolveMessage: Cannot resolve module"
      },
    }

    expect(errorMessage(err)).toBe("ResolveMessage: Cannot resolve module")

    const data = errorData(err)
    expect(data.message).toBe("ResolveMessage: Cannot resolve module")
    expect(String(data.formatted)).toContain("ResolveMessage")
  })

  test("errorFormat falls back for unserializable (circular) objects", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(errorFormat(circular)).toBe("Unexpected error (unserializable)")
  })

  test("errorFormat stringifies primitives directly", () => {
    expect(errorFormat("just a string")).toBe("just a string")
    expect(errorFormat(42)).toBe("42")
    expect(errorFormat(null)).toBe("null")
  })

  test("errorMessage falls back to the Error's name when message is empty", () => {
    const err = new Error("")
    err.name = "EmptyMessageError"
    expect(errorMessage(err)).toBe("EmptyMessageError")
  })

  test("errorMessage extracts a nested data.message", () => {
    const err = { data: { message: "nested failure" } }
    expect(errorMessage(err)).toBe("nested failure")
  })

  test("errorMessage falls back to 'unknown error' for a plain object with nothing usable", () => {
    expect(errorMessage({})).toBe("unknown error")
  })

  test("errorData handles a thrown primitive (not an Error, not a record)", () => {
    const data = errorData("just a string reason")
    expect(data.type).toBe("string")
    expect(data.message).toBe("just a string reason")
  })

  test("errorData includes the cause when an Error has one", () => {
    const cause = new Error("root cause")
    const err = new Error("wrapper", { cause })
    const data = errorData(err)
    expect(String(data.cause)).toContain("root cause")
  })

  test("errorData omits cause when the Error has none", () => {
    const data = errorData(new Error("standalone"))
    expect(data.cause).toBeUndefined()
  })
})
