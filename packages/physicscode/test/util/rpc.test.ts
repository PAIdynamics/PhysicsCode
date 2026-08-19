import { afterEach, describe, expect, test } from "bun:test"
import { Rpc } from "@/util/rpc"

describe("util.Rpc.client", () => {
  function fakeWorker() {
    const sent: unknown[] = []
    const target: {
      postMessage: (data: string) => void
      onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
    } = {
      postMessage: (data: string) => {
        sent.push(JSON.parse(data))
      },
      onmessage: null,
    }
    return {
      target,
      sent,
      receive: (data: unknown) => {
        // Strip the `this: Worker` parameter type before calling - rpc.ts
        // never actually reads `this`, that annotation just documents the
        // real Worker.onmessage call convention.
        const handler = target.onmessage as ((ev: MessageEvent<any>) => any) | null
        return handler!({ data: JSON.stringify(data) } as MessageEvent<any>)
      },
    }
  }

  test("call posts an rpc.request and resolves on the matching rpc.result", async () => {
    const { target, sent, receive } = fakeWorker()
    const client = Rpc.client<{ greet: (input: { name: string }) => string }>(target)

    const promise = client.call("greet", { name: "ada" })
    expect(sent).toEqual([{ type: "rpc.request", method: "greet", input: { name: "ada" }, id: 0 }])

    receive({ type: "rpc.result", result: "hello ada", id: 0 })
    expect(await promise).toBe("hello ada")
  })

  test("assigns increasing ids across multiple calls", async () => {
    const { target, sent, receive } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    const first = client.call("noop", undefined)
    const second = client.call("noop", undefined)
    expect(sent.map((item: any) => item.id)).toEqual([0, 1])

    receive({ type: "rpc.result", result: "second", id: 1 })
    receive({ type: "rpc.result", result: "first", id: 0 })
    expect(await first).toBe("first")
    expect(await second).toBe("second")
  })

  test("ignores an rpc.result for an id that was already resolved or never sent", async () => {
    const { target, receive } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    const promise = client.call("noop", undefined)
    receive({ type: "rpc.result", result: "first", id: 0 })
    // A duplicate/stray result for the same id must not throw or hang.
    receive({ type: "rpc.result", result: "stray", id: 0 })
    expect(await promise).toBe("first")
  })

  test("on() invokes registered handlers for a matching rpc.event", () => {
    const worker = fakeWorker()
    const client = Rpc.client<Record<string, never>>(worker.target)

    const received: unknown[] = []
    client.on("status", (data) => received.push(data))
    worker.receive({ type: "rpc.event", event: "status", data: { ok: true } })

    expect(received).toEqual([{ ok: true }])
  })

  test("on() supports multiple handlers for the same event", () => {
    const worker = fakeWorker()
    const client = Rpc.client<Record<string, never>>(worker.target)

    const a: unknown[] = []
    const b: unknown[] = []
    client.on("status", (data) => a.push(data))
    client.on("status", (data) => b.push(data))
    worker.receive({ type: "rpc.event", event: "status", data: "ping" })

    expect(a).toEqual(["ping"])
    expect(b).toEqual(["ping"])
  })

  test("on() unsubscribe stops future delivery without affecting other handlers", () => {
    const worker = fakeWorker()
    const client = Rpc.client<Record<string, never>>(worker.target)

    const a: unknown[] = []
    const b: unknown[] = []
    const off = client.on("status", (data) => a.push(data))
    client.on("status", (data) => b.push(data))

    off()
    worker.receive({ type: "rpc.event", event: "status", data: "ping" })

    expect(a).toEqual([])
    expect(b).toEqual(["ping"])
  })

  test("ignores rpc.event messages with no registered handlers", () => {
    const worker = fakeWorker()
    Rpc.client<Record<string, never>>(worker.target)
    expect(() => worker.receive({ type: "rpc.event", event: "unhandled", data: null })).not.toThrow()
  })
})

describe("util.Rpc.listen / emit", () => {
  const originalPostMessage = (globalThis as any).postMessage
  const originalOnMessage = (globalThis as any).onmessage

  afterEach(() => {
    ;(globalThis as any).postMessage = originalPostMessage
    ;(globalThis as any).onmessage = originalOnMessage
  })

  test("listen dispatches an rpc.request to the matching method and posts back rpc.result", async () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.listen({
      add: (input: { a: number; b: number }) => input.a + input.b,
    })

    await (globalThis as any).onmessage({ data: JSON.stringify({ type: "rpc.request", method: "add", input: { a: 2, b: 3 }, id: 7 }) })

    expect(posted).toEqual([{ type: "rpc.result", result: 5, id: 7 }])
  })

  test("listen awaits an async rpc method before posting the result", async () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.listen({
      slow: async (input: { value: string }) => {
        await Promise.resolve()
        return input.value.toUpperCase()
      },
    })

    await (globalThis as any).onmessage({
      data: JSON.stringify({ type: "rpc.request", method: "slow", input: { value: "hi" }, id: 1 }),
    })

    expect(posted).toEqual([{ type: "rpc.result", result: "HI", id: 1 }])
  })

  test("listen ignores non rpc.request messages", async () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.listen({ add: (input: { a: number; b: number }) => input.a + input.b })

    await (globalThis as any).onmessage({ data: JSON.stringify({ type: "rpc.event", event: "noop", data: null }) })

    expect(posted).toEqual([])
  })

  test("emit posts an rpc.event with the given event name and data", () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.emit("status", { ready: true })

    expect(posted).toEqual([{ type: "rpc.event", event: "status", data: { ready: true } }])
  })
})
