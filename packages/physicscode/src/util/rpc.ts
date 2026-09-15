type Definition = {
  [method: string]: (input: any) => any
}

// Messages that arrive in the worker before `listen()` has installed the real
// handler. Bun (like the browser) drops a worker message that is dispatched
// while `onmessage` is unset, so the worker must call `queue()` synchronously
// at the very top of its entry script, before any top-level await.
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
      const fn = rpc[parsed.method]
      if (!fn) throw new Error(`unknown rpc method: ${parsed.method}`)
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

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  // Requests are held back until the worker reports `rpc.ready`; anything
  // posted earlier could be silently dropped and would hang the caller forever.
  let ready = false
  const outbox: string[] = []
  let id = 0
  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.ready") {
      ready = true
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
        pending.set(requestId, { resolve, reject })
        const msg = JSON.stringify({ type: "rpc.request", method, input, id: requestId })
        if (ready) target.postMessage(msg)
        else outbox.push(msg)
      })
    },
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
