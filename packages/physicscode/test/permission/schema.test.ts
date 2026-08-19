import { describe, expect, test } from "bun:test"
import { PermissionID } from "@/permission/schema"

describe("permission.schema.PermissionID", () => {
  test("ascending() generates an id prefixed with 'per'", () => {
    expect((PermissionID.ascending() as unknown as string).startsWith("per")).toBe(true)
  })

  test("ascending() generates unique, monotonically increasing ids", () => {
    const a = PermissionID.ascending()
    const b = PermissionID.ascending()
    expect(a).not.toBe(b)
    expect(a < b).toBe(true)
  })

  test("ascending() accepts an existing id", () => {
    const given = PermissionID.ascending()
    expect(PermissionID.ascending(given as unknown as string)).toBe(given)
  })

  test("exposes a zod schema that parses a generated id", () => {
    const id = PermissionID.ascending()
    expect(PermissionID.zod.parse(id)).toBe(id)
  })
})
