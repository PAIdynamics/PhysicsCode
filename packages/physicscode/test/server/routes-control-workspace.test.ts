import { describe, expect, test } from "bun:test"
import { WorkspaceRoutes } from "@/server/routes/control/workspace"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("server.routes.control.WorkspaceRoutes", () => {
  test("GET /adapter lists available workspace adapters, including Worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await WorkspaceRoutes().fetch(new Request("http://localhost/adapter"))
        expect(res.status).toBe(200)
        const body = (await res.json()) as Array<{ name: string; type: string }>
        expect(body.some((a) => a.name === "Worktree")).toBe(true)
      },
    })
  })

  test("GET / lists workspaces (empty for a fresh project)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await WorkspaceRoutes().fetch(new Request("http://localhost/"))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([])
      },
    })
  })

  test("GET /status returns an empty list for a fresh project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await WorkspaceRoutes().fetch(new Request("http://localhost/status"))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([])
      },
    })
  })

  test("POST / rejects an invalid body", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await WorkspaceRoutes().fetch(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: 12345 }),
          }),
        )
        expect(res.status).toBe(400)
      },
    })
  })
})
