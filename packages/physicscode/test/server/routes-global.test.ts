import { describe, expect, test } from "bun:test"
import { GlobalRoutes } from "@/server/routes/global"
import { GlobalBus } from "@/bus/global"
import { InstallationVersion } from "@physicscode-ai/core/installation/version"

describe("server.routes.GlobalRoutes", () => {
  test("GET /health returns healthy + version", async () => {
    const res = await GlobalRoutes().fetch(new Request("http://localhost/health"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ healthy: true, version: InstallationVersion })
  })

  test("GET /config returns the global config", async () => {
    const res = await GlobalRoutes().fetch(new Request("http://localhost/config"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body).toBe("object")
  })

  test("PATCH /config updates and returns the global config", async () => {
    const getRes = await GlobalRoutes().fetch(new Request("http://localhost/config"))
    const current = await getRes.json()

    const res = await GlobalRoutes().fetch(
      new Request("http://localhost/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(current),
      }),
    )
    expect(res.status).toBe(200)
  })

  test("PATCH /config rejects an invalid body", async () => {
    const res = await GlobalRoutes().fetch(
      new Request("http://localhost/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ not_a_valid_config_field: 123, provider: "should be an object not a string" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test("GET /event streams a connected event, then forwards GlobalBus events", async () => {
    const controller = new AbortController()
    const res = await GlobalRoutes().fetch(new Request("http://localhost/event", { signal: controller.signal }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    async function readEvent(): Promise<string> {
      let buffer = ""
      while (!buffer.includes("\n\n")) {
        const { value, done } = await reader.read()
        if (done) throw new Error("stream closed before an event arrived")
        buffer += decoder.decode(value, { stream: true })
      }
      return buffer
    }

    try {
      const first = await readEvent()
      expect(first).toContain("server.connected")

      GlobalBus.emit("event", { directory: "global", payload: { type: "custom.test.event", properties: {} } })

      const second = await readEvent()
      expect(second).toContain("custom.test.event")
    } finally {
      controller.abort()
      await reader.cancel().catch(() => {})
    }
  })

  test("POST /dispose disposes instances and emits a global.disposed event", async () => {
    const received = Promise.withResolvers<any>()
    function handler(event: any) {
      if (event.payload?.type === "global.disposed") {
        GlobalBus.off("event", handler)
        received.resolve(event)
      }
    }
    GlobalBus.on("event", handler)

    const res = await GlobalRoutes().fetch(new Request("http://localhost/dispose", { method: "POST" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)

    const event = await received.promise
    expect(event.directory).toBe("global")
  })
})
