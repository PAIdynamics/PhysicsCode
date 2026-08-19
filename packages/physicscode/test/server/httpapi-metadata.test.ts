import { describe, expect, test } from "bun:test"
import { Context, Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { described, responseDescription } from "@/server/routes/instance/httpapi/groups/metadata"

describe("httpapi.groups.metadata.described", () => {
  test("annotates the schema with the given description", () => {
    const schema = described(Schema.String, "a session identifier")
    expect(schema.ast.annotations?.description).toBe("a session identifier")
  })

  test("returns a schema that still validates the same values", () => {
    const schema = described(Schema.String, "desc")
    expect(Schema.decodeUnknownSync(schema)("hello")).toBe("hello")
  })
})

describe("httpapi.groups.metadata.responseDescription", () => {
  function getTransform(description: string) {
    // OpenApi.annotations() types its return as Context.Context<never> even
    // though at runtime it really does carry the Transform entry (that's
    // just how these OpenApi annotation contexts are meant to be consumed
    // internally, not looked up directly) - cast to the real shape to read
    // it back out here.
    const context = responseDescription(description) as Context.Context<OpenApi.Transform>
    return Context.get(context, OpenApi.Transform)
  }

  test("overwrites the 200 response's description", () => {
    const transform = getTransform("Custom description")
    const operation = { responses: { "200": { description: "old" } } }

    const result = transform(operation) as typeof operation

    expect(result.responses["200"].description).toBe("Custom description")
  })

  test("returns the operation unchanged when there is no 200 response", () => {
    const transform = getTransform("Custom description")
    const operation = { responses: {} }

    expect(transform(operation)).toEqual(operation)
  })

  test("returns the operation unchanged when the 200 response isn't an object", () => {
    const transform = getTransform("Custom description")
    const operation = { responses: { "200": "not-an-object" } }

    expect(transform(operation)).toEqual(operation)
  })

  test("returns the same operation reference (mutates in place)", () => {
    const transform = getTransform("Custom description")
    const operation = { responses: { "200": { description: "old" } } }

    expect(transform(operation)).toBe(operation)
  })
})
