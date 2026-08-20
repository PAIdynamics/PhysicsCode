import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "@/project/instance"
import { McpRoutes } from "@/server/routes/instance/mcp"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function withMcp(dir: string, path: string, init?: RequestInit) {
  return Instance.provide({
    directory: dir,
    fn: () => McpRoutes().request(path, init),
  })
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("legacy McpRoutes", () => {
  test("GET / serves the status of configured servers", async () => {
    await using tmp = await tmpdir({
      config: { mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } } },
    })

    const res = await withMcp(tmp.path, "/")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ demo: { status: "disabled" } })
  })

  test("POST / adds a new server and returns updated status", async () => {
    await using tmp = await tmpdir({
      config: { mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } } },
    })

    const res = await withMcp(tmp.path, "/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "added", config: { type: "local", command: ["echo", "added"], enabled: false } }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ added: { status: "disabled" } })
  })

  test("POST /:name/connect and /:name/disconnect toggle server state", async () => {
    await using tmp = await tmpdir({
      config: { mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } } },
    })

    const connected = await withMcp(tmp.path, "/demo/connect", { method: "POST" })
    expect(connected.status).toBe(200)
    expect(await connected.json()).toBe(true)

    const disconnected = await withMcp(tmp.path, "/demo/disconnect", { method: "POST" })
    expect(disconnected.status).toBe(200)
    expect(await disconnected.json()).toBe(true)
  })

  test("POST /:name/auth returns 400 when the server does not support OAuth", async () => {
    await using tmp = await tmpdir({
      config: { mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } } },
    })

    const res = await withMcp(tmp.path, "/demo/auth", { method: "POST" })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "MCP server demo does not support OAuth" })
  })

  test("POST /:name/auth/authenticate returns 400 when the server does not support OAuth", async () => {
    await using tmp = await tmpdir({
      config: { mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } } },
    })

    const res = await withMcp(tmp.path, "/demo/auth/authenticate", { method: "POST" })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "MCP server demo does not support OAuth" })
  })

  test("DELETE /:name/auth removes OAuth credentials", async () => {
    await using tmp = await tmpdir({
      config: { mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } } },
    })

    const res = await withMcp(tmp.path, "/demo/auth", { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  test("POST /:name/auth/callback fails for a server that does not support OAuth", async () => {
    await using tmp = await tmpdir({
      config: { mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } } },
    })

    const res = await withMcp(tmp.path, "/demo/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "fake-code" }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
