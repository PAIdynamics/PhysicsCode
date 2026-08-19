import { describe, expect, test } from "bun:test"
import { AsyncQueue, work } from "@/util/queue"

describe("util.AsyncQueue", () => {
  test("next() resolves immediately with a value pushed before it was called", async () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    expect(await queue.next()).toBe(1)
  })

  test("next() resolves in FIFO order for multiple pushed values", async () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    queue.push(2)
    queue.push(3)
    expect(await queue.next()).toBe(1)
    expect(await queue.next()).toBe(2)
    expect(await queue.next()).toBe(3)
  })

  test("next() waits for a value pushed after it was called", async () => {
    const queue = new AsyncQueue<string>()
    const pending = queue.next()
    queue.push("later")
    expect(await pending).toBe("later")
  })

  test("resolves multiple waiting next() calls in the order they were requested", async () => {
    const queue = new AsyncQueue<number>()
    const first = queue.next()
    const second = queue.next()
    queue.push(1)
    queue.push(2)
    expect(await first).toBe(1)
    expect(await second).toBe(2)
  })

  test("Symbol.asyncIterator yields pushed values in order", async () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    queue.push(2)
    queue.push(3)

    const results: number[] = []
    for await (const item of queue) {
      results.push(item)
      if (results.length === 3) break
    }

    expect(results).toEqual([1, 2, 3])
  })
})

describe("util.work", () => {
  test("processes every item exactly once", async () => {
    const seen: number[] = []
    await work(2, [1, 2, 3, 4, 5], async (item) => {
      seen.push(item)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  test("does nothing for an empty items array", async () => {
    let calls = 0
    await work(3, [], async () => {
      calls++
    })
    expect(calls).toBe(0)
  })

  test("respects the concurrency limit (never runs more than N in flight)", async () => {
    let inFlight = 0
    let maxInFlight = 0
    await work(2, [1, 2, 3, 4, 5, 6], async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
    })
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })

  test("propagates an error from fn and stops processing", async () => {
    let calls = 0
    await expect(
      work(1, [1, 2, 3], async (item) => {
        calls++
        if (item === 2) throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(calls).toBeLessThan(3)
  })
})
