import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import { Instance } from "@/project/instance"
import { ErrorMiddleware } from "@/server/middleware"
import { PtyRoutes } from "@/server/routes/instance/pty"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const testPty = process.platform === "win32" ? test.skip : test

const { upgradeWebSocket } = createBunWebSocket()

// PtyRoutes throws NamedErrors (e.g. NotFoundError) and relies on the
// server's top-level onError handler (src/server/middleware.ts) to map
// them to the right status code - mount it the same way server.ts does
// rather than hitting PtyRoutes() bare, which would surface those as 500s.
function withPty(dir: string, path: string, init?: RequestInit) {
  return Instance.provide({
    directory: dir,
    fn: () => new Hono().onError(ErrorMiddleware).route("/", PtyRoutes(upgradeWebSocket)).request(path, init),
  })
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("legacy PtyRoutes", () => {
  test("GET /shells lists available shells", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const res = await withPty(tmp.path, "/shells")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.any(String), name: expect.any(String), acceptable: expect.any(Boolean) }),
      ]),
    )
  })

  test("GET /:ptyID returns 404 for a session that doesn't exist", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const res = await withPty(tmp.path, "/pty_does_not_exist")
    expect(res.status).toBe(404)
  })

  testPty("full JSON lifecycle: list/create/get/update/remove", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const list = await withPty(tmp.path, "/")
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual([])

    const created = await withPty(tmp.path, "/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "sleep 5"], title: "demo" }),
    })
    expect(created.status).toBe(200)
    const info = (await created.json()) as { id: string }
    expect(info).toMatchObject({ title: "demo", command: "/usr/bin/env", status: "running" })

    try {
      const found = await withPty(tmp.path, `/${info.id}`)
      expect(found.status).toBe(200)
      expect(await found.json()).toMatchObject({ id: info.id, title: "demo" })

      const updated = await withPty(tmp.path, `/${info.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "renamed", size: { cols: 80, rows: 24 } }),
      })
      expect(updated.status).toBe(200)
      expect(await updated.json()).toMatchObject({ id: info.id, title: "renamed" })
    } finally {
      const removed = await withPty(tmp.path, `/${info.id}`, { method: "DELETE" })
      expect(removed.status).toBe(200)
      expect(await removed.json()).toBe(true)
    }

    const missing = await withPty(tmp.path, `/${info.id}`)
    expect(missing.status).toBe(404)
  })
})
