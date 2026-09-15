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
    const receive = (data: unknown) => {
      // Strip the `this: Worker` parameter type before calling - rpc.ts
      // never actually reads `this`, that annotation just documents the
      // real Worker.onmessage call convention.
      const handler = target.onmessage as ((ev: MessageEvent<any>) => any) | null
      return handler!({ data: JSON.stringify(data) } as MessageEvent<any>)
    }
    return {
      target,
      sent,
      receive,
      ready: () => receive({ type: "rpc.ready" }),
    }
  }

  test("call posts an rpc.request and resolves on the matching rpc.result", async () => {
    const { target, sent, receive, ready } = fakeWorker()
    const client = Rpc.client<{ greet: (input: { name: string }) => string }>(target)
    ready()

    const promise = client.call("greet", { name: "ada" })
    expect(sent).toEqual([{ type: "rpc.request", method: "greet", input: { name: "ada" }, id: 0 }])

    receive({ type: "rpc.result", result: "hello ada", id: 0 })
    expect(await promise).toBe("hello ada")
  })

  test("assigns increasing ids across multiple calls", async () => {
    const { target, sent, receive, ready } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)
    ready()

    const first = client.call("noop", undefined)
    const second = client.call("noop", undefined)
    expect(sent.map((item: any) => item.id)).toEqual([0, 1])

    receive({ type: "rpc.result", result: "second", id: 1 })
    receive({ type: "rpc.result", result: "first", id: 0 })
    expect(await first).toBe("first")
    expect(await second).toBe("second")
  })

  test("ignores an rpc.result for an id that was already resolved or never sent", async () => {
    const { target, receive, ready } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)
    ready()

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

describe("util.Rpc.client readiness and errors", () => {
  test("holds requests until the worker reports rpc.ready, then flushes in order", async () => {
    const { target, sent, receive, ready } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    const first = client.call("noop", undefined)
    const second = client.call("noop", undefined)
    expect(sent).toEqual([])

    ready()
    expect(sent.map((item: any) => item.id)).toEqual([0, 1])

    receive({ type: "rpc.result", result: "a", id: 0 })
    receive({ type: "rpc.result", result: "b", id: 1 })
    expect(await first).toBe("a")
    expect(await second).toBe("b")
  })

  test("rejects the matching call on rpc.error instead of hanging", async () => {
    const { target, receive, ready } = fakeWorker()
    const client = Rpc.client<{ boom: (input: undefined) => string }>(target)
    ready()

    const promise = client.call("boom", undefined)
    receive({ type: "rpc.error", error: "kaboom", id: 0 })
    await expect(promise).rejects.toThrow("kaboom")
  })

  test("fail() rejects both in-flight and still-queued calls", async () => {
    const { target, receive, ready } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    ready()
    const inflight = client.call("noop", undefined)
    // Nothing flushes this one - the worker is gone before it is answered.
    const queued = client.call("noop", undefined)

    client.fail(new Error("worker died"))

    await expect(inflight).rejects.toThrow("worker died")
    await expect(queued).rejects.toThrow("worker died")
    // A late result for a rejected id must not throw.
    expect(() => receive({ type: "rpc.result", result: "late", id: 0 })).not.toThrow()
  })

  test("fail() rejects calls queued before the worker ever became ready", async () => {
    const { target, sent } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    const promise = client.call("noop", undefined)
    expect(sent).toEqual([])

    client.fail(new Error("worker failed to start"))

    await expect(promise).rejects.toThrow("worker failed to start")
    // The outbox is discarded rather than flushed later.
    expect(sent).toEqual([])
  })

  test("calls made after fail() reject immediately instead of queueing", async () => {
    const { target, sent } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    client.fail(new Error("worker died"))
    await expect(client.call("noop", undefined)).rejects.toThrow("worker died")
    expect(sent).toEqual([])
  })

  test("fail() keeps the first error and ignores a later one", async () => {
    const { target } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    client.fail(new Error("first"))
    client.fail(new Error("second"))
    await expect(client.call("noop", undefined)).rejects.toThrow("first")
  })

  test("a late rpc.ready after fail() does not flush or revive the client", async () => {
    const { target, sent, ready } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    const promise = client.call("noop", undefined)
    client.fail(new Error("worker died"))
    await expect(promise).rejects.toThrow("worker died")

    ready()

    expect(sent).toEqual([])
    await expect(client.call("noop", undefined)).rejects.toThrow("worker died")
  })

  test("readyTimeout rejects queued calls when rpc.ready never arrives", async () => {
    const { target, sent } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target, { readyTimeout: 10 })

    const promise = client.call("noop", undefined)

    await expect(promise).rejects.toThrow("worker did not report ready within 10ms")
    expect(sent).toEqual([])
  })

  test("isReady reflects the handshake so callers can tell bootstrap failure from a later error", async () => {
    const { target, ready } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target)

    expect(client.isReady()).toBe(false)
    ready()
    expect(client.isReady()).toBe(true)
  })

  test("readyTimeout does not fire once the worker reports ready", async () => {
    const { target, receive, ready } = fakeWorker()
    const client = Rpc.client<{ noop: (input: undefined) => string }>(target, { readyTimeout: 10 })

    ready()
    const promise = client.call("noop", undefined)
    await new Promise((resolve) => setTimeout(resolve, 30))

    receive({ type: "rpc.result", result: "ok", id: 0 })
    expect(await promise).toBe("ok")
  })

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
    const receive = (data: unknown) => {
      const handler = target.onmessage as ((ev: MessageEvent<any>) => any) | null
      return handler!({ data: JSON.stringify(data) } as MessageEvent<any>)
    }
    return { target, sent, receive, ready: () => receive({ type: "rpc.ready" }) }
  }
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

    expect(posted).toEqual([{ type: "rpc.ready" }, { type: "rpc.result", result: 5, id: 7 }])
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

    expect(posted).toEqual([{ type: "rpc.ready" }, { type: "rpc.result", result: "HI", id: 1 }])
  })

  test("listen ignores non rpc.request messages", async () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.listen({ add: (input: { a: number; b: number }) => input.a + input.b })

    await (globalThis as any).onmessage({ data: JSON.stringify({ type: "rpc.event", event: "noop", data: null }) })

    expect(posted).toEqual([{ type: "rpc.ready" }])
  })

  test("listen posts rpc.error when a method throws", async () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.listen({
      boom: async () => {
        throw new Error("kaboom")
      },
    })

    await (globalThis as any).onmessage({ data: JSON.stringify({ type: "rpc.request", method: "boom", input: undefined, id: 3 }) })

    expect(posted).toEqual([{ type: "rpc.ready" }, { type: "rpc.error", error: "kaboom", id: 3 }])
  })

  test("listen rejects inherited Object.prototype members as unknown methods", async () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.listen({ add: (input: { a: number; b: number }) => input.a + input.b })

    // `rpc["toString"]` resolves through the prototype chain, so a bare lookup
    // would have invoked it and replied with a bogus rpc.result.
    await (globalThis as any).onmessage({
      data: JSON.stringify({ type: "rpc.request", method: "toString", input: undefined, id: 4 }),
    })

    expect(posted).toEqual([{ type: "rpc.ready" }, { type: "rpc.error", error: "unknown rpc method: toString", id: 4 }])
  })

  test("queue() buffers requests that arrive before listen() and replays them", async () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.queue()
    await (globalThis as any).onmessage({ data: JSON.stringify({ type: "rpc.request", method: "add", input: { a: 1, b: 1 }, id: 9 }) })
    expect(posted).toEqual([])

    Rpc.listen({ add: (input: { a: number; b: number }) => input.a + input.b })
    await Promise.resolve()
    await Promise.resolve()

    expect(posted).toEqual([{ type: "rpc.ready" }, { type: "rpc.result", result: 2, id: 9 }])
  })

  test("emit posts an rpc.event with the given event name and data", () => {
    const posted: unknown[] = []
    ;(globalThis as any).postMessage = (data: string) => posted.push(JSON.parse(data))

    Rpc.emit("status", { ready: true })

    expect(posted).toEqual([{ type: "rpc.event", event: "status", data: { ready: true } }])
  })
})
