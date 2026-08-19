import { describe, expect, test } from "bun:test"
import { defer } from "@/util/defer"

describe("util.defer", () => {
  test("Symbol.dispose invokes the callback synchronously", () => {
    let called = false
    const disposable = defer(() => {
      called = true
    })
    disposable[Symbol.dispose]()
    expect(called).toBe(true)
  })

  test("Symbol.dispose fires an async callback without awaiting its promise", () => {
    let resolved = false
    const disposable = defer(async () => {
      resolved = true
    })
    disposable[Symbol.dispose]()
    // An async function body runs synchronously up to its first `await`,
    // so `resolved` is already set even though [Symbol.dispose] itself
    // never awaits the returned promise.
    expect(resolved).toBe(true)
  })

  test("Symbol.asyncDispose awaits the callback and resolves", async () => {
    let called = false
    const disposable = defer(() => {
      called = true
    })
    await disposable[Symbol.asyncDispose]()
    expect(called).toBe(true)
  })

  test("Symbol.asyncDispose awaits an async callback before resolving", async () => {
    const order: string[] = []
    const disposable = defer(async () => {
      order.push("start")
      await Promise.resolve()
      order.push("end")
    })
    await disposable[Symbol.asyncDispose]()
    expect(order).toEqual(["start", "end"])
  })

  test("works with `using` for synchronous scoped disposal", () => {
    let called = false
    {
      using _disposable = defer(() => {
        called = true
      })
      expect(called).toBe(false)
    }
    expect(called).toBe(true)
  })

  test("works with `await using` for async scoped disposal", async () => {
    let called = false
    {
      await using _disposable = defer(async () => {
        called = true
      })
      expect(called).toBe(false)
    }
    expect(called).toBe(true)
  })
})
