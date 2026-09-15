type Definition = {
  [method: string]: (input: any) => any
}

// Messages that arrive in the worker before `listen()` has installed the real
// handler. Bun (like the browser) drops a worker message dispatched while
// `onmessage` is unset.
//
// `queue()` narrows that window but cannot close it, so do not rely on it:
// ESM evaluates an entry script's imports before its first statement, and
// `worker.ts` transitively imports `@physicscode-ai/core/global`, which has a
// top-level await. Execution yields to the event loop there, before `queue()`
// ever runs. What actually guarantees no request is lost is the `rpc.ready`
// handshake below, which holds the client's requests until `listen()` is
// installed.
let queued: MessageEvent<any>[] | undefined

export function queue() {
  queued = []
  onmessage = (evt) => {
    queued?.push(evt)
  }
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message
  return String(e)
}

export function listen(rpc: Definition) {
  const handler = async (evt: MessageEvent<any>) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type !== "rpc.request") return
    try {
      // `hasOwn` rather than a bare lookup: `rpc["toString"]` and friends
      // resolve through Object.prototype, so a bare lookup would invoke them
      // as though they were real rpc methods.
      const fn = Object.hasOwn(rpc, parsed.method) ? rpc[parsed.method] : undefined
      if (typeof fn !== "function") throw new Error(`unknown rpc method: ${parsed.method}`)
      const result = await fn(parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    } catch (e) {
      postMessage(JSON.stringify({ type: "rpc.error", error: errorMessage(e), id: parsed.id }))
    }
  }
  onmessage = handler
  const pending = queued ?? []
  queued = undefined
  for (const evt of pending) void handler(evt)
  postMessage(JSON.stringify({ type: "rpc.ready" }))
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(
  target: {
    postMessage: (data: string) => void | null
    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  },
  options?: {
    // Reject everything in flight if the worker has not announced `rpc.ready`
    // within this many milliseconds. Without it, a worker that dies before
    // installing its handler leaves every call parked in `outbox` forever.
    readyTimeout?: number
  },
) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  // Requests are held back until the worker reports `rpc.ready`; anything
  // posted earlier could be silently dropped and would hang the caller forever.
  let ready = false
  let failure: Error | undefined
  const outbox: string[] = []
  let id = 0

  let readyTimer: ReturnType<typeof setTimeout> | undefined

  // Rejects every call - in flight and still queued - and makes later calls
  // fail fast, so a dead worker surfaces as an error instead of a hang.
  const fail = (error: Error) => {
    if (failure) return
    failure = error
    clearTimeout(readyTimer)
    outbox.length = 0
    const entries = [...pending.values()]
    pending.clear()
    for (const entry of entries) entry.reject(error)
  }

  const readyTimeout = options?.readyTimeout
  if (readyTimeout) {
    readyTimer = setTimeout(() => fail(new Error(`worker did not report ready within ${readyTimeout}ms`)), readyTimeout)
    readyTimer?.unref?.()
  }

  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.ready") {
      if (failure) return
      ready = true
      clearTimeout(readyTimer)
      const flush = outbox.splice(0)
      for (const msg of flush) target.postMessage(msg)
      return
    }
    if (parsed.type === "rpc.result") {
      const entry = pending.get(parsed.id)
      if (entry) {
        entry.resolve(parsed.result)
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.error") {
      const entry = pending.get(parsed.id)
      if (entry) {
        entry.reject(new Error(parsed.error))
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        if (failure) return reject(failure)
        pending.set(requestId, { resolve, reject })
        const msg = JSON.stringify({ type: "rpc.request", method, input, id: requestId })
        if (ready) target.postMessage(msg)
        else outbox.push(msg)
      })
    },
    fail,
    // Lets callers distinguish "the worker never finished bootstrapping" from
    // "the worker was up and then hit an error" - only the former should fail
    // the whole client.
    isReady: () => ready,
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
  }
}

export * as Rpc from "./rpc"
