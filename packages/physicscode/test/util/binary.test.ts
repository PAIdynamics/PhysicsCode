import { describe, expect, test } from "bun:test"
import { Binary } from "@physicscode-ai/core/util/binary"

type Item = { id: string; value: number }
const byId = (item: Item) => item.id

function items(...ids: string[]): Item[] {
  return ids.map((id, index) => ({ id, value: index }))
}

describe("Binary.search", () => {
  test("returns not found with insertion index for an empty array", () => {
    expect(Binary.search([], "a", byId)).toEqual({ found: false, index: 0 })
  })

  test("finds the only element in a single-element array", () => {
    expect(Binary.search(items("a"), "a", byId)).toEqual({ found: true, index: 0 })
  })

  test("returns the insertion point when the single element doesn't match", () => {
    expect(Binary.search(items("b"), "a", byId)).toEqual({ found: false, index: 0 })
    expect(Binary.search(items("b"), "c", byId)).toEqual({ found: false, index: 1 })
  })

  test("finds an element at the start, middle, and end of a sorted array", () => {
    const array = items("a", "b", "c", "d", "e")
    expect(Binary.search(array, "a", byId)).toEqual({ found: true, index: 0 })
    expect(Binary.search(array, "c", byId)).toEqual({ found: true, index: 2 })
    expect(Binary.search(array, "e", byId)).toEqual({ found: true, index: 4 })
  })

  test("returns the correct insertion index for a missing key between elements", () => {
    const array = items("a", "c", "e")
    expect(Binary.search(array, "b", byId)).toEqual({ found: false, index: 1 })
    expect(Binary.search(array, "d", byId)).toEqual({ found: false, index: 2 })
  })

  test("returns index 0 for a key that sorts before everything", () => {
    expect(Binary.search(items("b", "c"), "a", byId)).toEqual({ found: false, index: 0 })
  })

  test("returns the array length for a key that sorts after everything", () => {
    const array = items("a", "b")
    expect(Binary.search(array, "z", byId)).toEqual({ found: false, index: 2 })
  })
})

describe("Binary.insert", () => {
  test("inserts into an empty array", () => {
    const array: Item[] = []
    const result = Binary.insert(array, { id: "a", value: 1 }, byId)
    expect(result.map(byId)).toEqual(["a"])
    // mutates and returns the same array reference
    expect(result).toBe(array)
  })

  test("inserts at the beginning, middle, and end to keep the array sorted", () => {
    let array = items("b", "d")
    array = Binary.insert(array, { id: "a", value: 0 }, byId)
    expect(array.map(byId)).toEqual(["a", "b", "d"])

    array = Binary.insert(array, { id: "c", value: 0 }, byId)
    expect(array.map(byId)).toEqual(["a", "b", "c", "d"])

    array = Binary.insert(array, { id: "e", value: 0 }, byId)
    expect(array.map(byId)).toEqual(["a", "b", "c", "d", "e"])
  })

  test("inserts a duplicate key before existing equal-keyed elements", () => {
    const array = items("a", "b", "b", "c")
    const inserted = { id: "b", value: 99 }
    const result = Binary.insert(array, inserted, byId)
    expect(result.map(byId)).toEqual(["a", "b", "b", "b", "c"])
    // the binary search narrows to the leftmost slot where midId >= id, so a
    // duplicate lands before the existing equal-keyed entries, not after
    expect(result.indexOf(inserted)).toBe(1)
  })

  test("keeps a large run of inserts fully sorted", () => {
    const ids = ["m", "a", "z", "c", "y", "b", "x", "k"]
    let array: Item[] = []
    for (const id of ids) array = Binary.insert(array, { id, value: 0 }, byId)
    expect(array.map(byId)).toEqual([...ids].sort())
  })
})
