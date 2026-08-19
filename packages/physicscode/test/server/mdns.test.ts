import { describe, expect, test, mock, beforeEach } from "bun:test"

type PublishOptions = { name: string; type: string; host: string; port: number; txt: Record<string, string> }

let instances: Array<{
  published: PublishOptions[]
  unpublishAllCalls: number
  destroyCalls: number
  destroyThrows: boolean
  unpublishAllThrows: boolean
}> = []
let publishThrows = false

class FakeService {
  handlers: Record<string, ((arg?: unknown) => void)[]> = {}
  on(event: string, handler: (arg?: unknown) => void) {
    this.handlers[event] ??= []
    this.handlers[event].push(handler)
    return this
  }
}

class FakeBonjour {
  record: (typeof instances)[number]
  constructor() {
    this.record = { published: [], unpublishAllCalls: 0, destroyCalls: 0, destroyThrows: false, unpublishAllThrows: false }
    instances.push(this.record)
  }
  publish(opts: PublishOptions) {
    if (publishThrows) throw new Error("publish failed")
    this.record.published.push(opts)
    return new FakeService()
  }
  unpublishAll() {
    this.record.unpublishAllCalls++
    if (this.record.unpublishAllThrows) throw new Error("unpublishAll failed")
  }
  destroy() {
    this.record.destroyCalls++
    if (this.record.destroyThrows) throw new Error("destroy failed")
  }
}

void mock.module("bonjour-service", () => ({
  Bonjour: FakeBonjour,
}))

const { MDNS } = await import("@/server/mdns")

describe("server.MDNS", () => {
  beforeEach(() => {
    instances = []
    publishThrows = false
    MDNS.unpublish()
  })

  test("publish registers an http service with the default host and name", () => {
    MDNS.publish(4096)

    expect(instances).toHaveLength(1)
    expect(instances[0]!.published).toEqual([
      { name: "physicscode-4096", type: "http", host: "physicscode.local", port: 4096, txt: { path: "/" } },
    ])
  })

  test("publish uses a custom domain when provided", () => {
    MDNS.publish(4096, "custom.local")

    expect(instances[0]!.published[0]!.host).toBe("custom.local")
  })

  test("publish is a no-op when the port hasn't changed", () => {
    MDNS.publish(4096)
    MDNS.publish(4096)

    expect(instances).toHaveLength(1)
  })

  test("publishing a new port unpublishes the previous one first", () => {
    MDNS.publish(4096)
    MDNS.publish(5000)

    expect(instances).toHaveLength(2)
    expect(instances[0]!.unpublishAllCalls).toBe(1)
    expect(instances[0]!.destroyCalls).toBe(1)
    expect(instances[1]!.published[0]!.port).toBe(5000)
  })

  test("unpublish tears down the active service and clears state", () => {
    MDNS.publish(4096)
    MDNS.unpublish()

    expect(instances[0]!.unpublishAllCalls).toBe(1)
    expect(instances[0]!.destroyCalls).toBe(1)

    // Republishing the same port now creates a fresh service, proving the
    // dedup state (currentPort) was actually cleared.
    MDNS.publish(4096)
    expect(instances).toHaveLength(2)
  })

  test("unpublish without an active service is a safe no-op", () => {
    expect(() => MDNS.unpublish()).not.toThrow()
  })

  test("publish swallows errors from the underlying library and resets state", () => {
    publishThrows = true
    expect(() => MDNS.publish(4096)).not.toThrow()

    // State was reset, so a later successful publish for the same port
    // isn't treated as a no-op duplicate.
    publishThrows = false
    MDNS.publish(4096)
    expect(instances.at(-1)!.published).toHaveLength(1)
  })

  test("unpublish swallows errors from unpublishAll/destroy", () => {
    MDNS.publish(4096)
    instances[0]!.unpublishAllThrows = true

    expect(() => MDNS.unpublish()).not.toThrow()
  })
})
