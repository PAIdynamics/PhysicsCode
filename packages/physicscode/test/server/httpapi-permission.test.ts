import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@physicscode-ai/core/flag/flag"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Permission } from "@/permission"
import { Server } from "@/server/server"
import { SessionID } from "@/session/schema"
import { tmpdir } from "../fixture/fixture"

// Same pattern as httpapi-question.test.ts: exercises the permissionHandlers
// HttpApiBuilder wiring (src/server/routes/instance/httpapi/handlers/permission.ts)
// through the real in-process server, since that file is pure route
// registration with no logic of its own to unit test.

const original = Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

function ask(directory: string, overrides: Partial<Permission.AskInput> = {}) {
  return Instance.provide({
    directory,
    fn: () =>
      AppRuntime.runPromise(
        Permission.Service.use((svc) =>
          svc.ask({
            sessionID: SessionID.make("ses_test"),
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
            ...overrides,
          }),
        ),
      ),
  })
}

afterEach(async () => {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
})

describe("permission HttpApi", () => {
  test("GET /permission lists pending permission requests for the directory", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path)
    await new Promise((r) => setTimeout(r, 20))

    const res = await app().request("/permission", { headers: { "x-physicscode-directory": tmp.path } })
    expect(res.status).toBe(200)
    const list = (await res.json()) as Array<{ id: string; permission: string }>
    expect(list).toHaveLength(1)
    expect(list[0].permission).toBe("bash")

    await app().request(`/permission/${list[0].id}/reply`, {
      method: "POST",
      headers: { "x-physicscode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ reply: "reject" }),
    })
    await pending.catch(() => {})
  })

  test("POST /permission/:requestID/reply with 'once' resolves ask() without an error", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path)
    await new Promise((r) => setTimeout(r, 20))

    const listRes = await app().request("/permission", { headers: { "x-physicscode-directory": tmp.path } })
    const [entry] = (await listRes.json()) as Array<{ id: string }>

    const replyRes = await app().request(`/permission/${entry.id}/reply`, {
      method: "POST",
      headers: { "x-physicscode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ reply: "once" }),
    })
    expect(replyRes.status).toBe(200)
    expect(await replyRes.json()).toBe(true)

    await expect(pending).resolves.toBeUndefined()
  })

  test("POST /permission/:requestID/reply with 'reject' fails ask() with a RejectedError", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path)
    await new Promise((r) => setTimeout(r, 20))

    const listRes = await app().request("/permission", { headers: { "x-physicscode-directory": tmp.path } })
    const [entry] = (await listRes.json()) as Array<{ id: string }>

    const replyRes = await app().request(`/permission/${entry.id}/reply`, {
      method: "POST",
      headers: { "x-physicscode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ reply: "reject", message: "not now" }),
    })
    expect(replyRes.status).toBe(200)

    await expect(pending).rejects.toThrow()
  })

  test("GET /permission returns an empty list for a directory with no pending requests", async () => {
    await using tmp = await tmpdir()
    const res = await app().request("/permission", { headers: { "x-physicscode-directory": tmp.path } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
