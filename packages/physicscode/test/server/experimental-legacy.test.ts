import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Hono } from "hono"
import { GlobalBus } from "@/bus/global"
import { Instance } from "@/project/instance"
import { ErrorMiddleware } from "@/server/middleware"
import { ExperimentalRoutes } from "@/server/routes/instance/experimental"
import { Session } from "@/session/session"
import { Database } from "@/storage/db"
import { Worktree } from "@/worktree"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const testWorktreeMutations = process.platform === "win32" ? test.skip : test

// Mounted with the same onError wiring server.ts uses in production -
// ExperimentalRoutes() alone has no error handling, so hitting it bare
// would surface thrown errors as rejected promises instead of the real
// HTTP error responses clients actually receive.
function withExperimental(dir: string, path: string, init?: RequestInit) {
  return Instance.provide({
    directory: dir,
    fn: () => new Hono().onError(ErrorMiddleware).route("/", ExperimentalRoutes()).request(path, init),
  })
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

function createSession(input?: Session.CreateInput) {
  return runSession(Session.Service.use((svc) => svc.create(input)))
}

async function waitReady(directory: string) {
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", onEvent)
      reject(new Error("timed out waiting for worktree.ready"))
    }, 10_000)

    function onEvent(event: { directory?: string; payload: { type?: string } }) {
      if (event.payload.type !== Worktree.Event.Ready.type || event.directory !== directory) return
      clearTimeout(timer)
      GlobalBus.off("event", onEvent)
      resolve()
    }

    GlobalBus.on("event", onEvent)
  })
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("legacy ExperimentalRoutes", () => {
  test("serves read-only experimental endpoints", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        mcp: { demo: { type: "local", command: ["echo", "demo"], enabled: false } },
      },
    })

    const [consoleState, consoleOrgs, toolList, toolIDs, worktrees, resources] = await Promise.all([
      withExperimental(tmp.path, "/console"),
      withExperimental(tmp.path, "/console/orgs"),
      withExperimental(tmp.path, "/tool?provider=physicscode&model=gpt-5"),
      withExperimental(tmp.path, "/tool/ids"),
      withExperimental(tmp.path, "/worktree"),
      withExperimental(tmp.path, "/resource"),
    ])

    expect(consoleState.status).toBe(200)
    expect(await consoleState.json()).toEqual({
      consoleManagedProviders: [],
      switchableOrgCount: 0,
    })

    expect(consoleOrgs.status).toBe(200)
    expect(await consoleOrgs.json()).toEqual({ orgs: [] })

    expect(toolList.status).toBe(200)
    expect(await toolList.json()).toContainEqual(
      expect.objectContaining({
        id: "bash",
        description: expect.any(String),
        parameters: expect.any(Object),
      }),
    )

    expect(toolIDs.status).toBe(200)
    expect(await toolIDs.json()).toContain("bash")

    expect(worktrees.status).toBe(200)
    expect(await worktrees.json()).toEqual([])

    expect(resources.status).toBe(200)
    expect(await resources.json()).toEqual({})
  })

  test("serves Console org switch", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    Database.Client()
      .$client.prepare(
        "INSERT INTO account (id, email, url, access_token, refresh_token, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "account-test-legacy",
        "test-legacy@example.com",
        "https://console.example.com",
        "access",
        "refresh",
        Date.now(),
        Date.now(),
      )

    const switched = await withExperimental(tmp.path, "/console/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountID: "account-test-legacy", orgID: "org-test" }),
    })

    expect(switched.status).toBe(200)
    expect(await switched.json()).toBe(true)
  })

  test("POST /console/login surfaces a clean 400 error instead of a 500 stack trace", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const res = await withExperimental(tmp.path, "/console/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Port 1 refuses connections immediately, deterministically triggering
      // Account.Service's AccountTransportError without a real network call.
      body: JSON.stringify({ url: "http://127.0.0.1:1" }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { name: string; data: { message: string } }
    expect(body.name).toBe("UnknownError")
    expect(body.data.message).toContain("Could not reach")
    expect(body.data.message.split("\n").length).toBeLessThan(5)
  })

  test("POST /console/login/api-key surfaces a clean 400 error instead of a 500 stack trace", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const res = await withExperimental(tmp.path, "/console/login/api-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:1", apiKey: "sk-test" }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { name: string; data: { message: string } }
    expect(body.name).toBe("UnknownError")
    expect(body.data.message).toContain("Could not reach")
  })

  test("serves global session list", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "page-two" }),
    })

    const page = await withExperimental(
      tmp.path,
      `/session?${new URLSearchParams({ directory: tmp.path, limit: "1" })}`,
    )
    expect(page.status).toBe(200)
    expect(page.headers.get("x-next-cursor")).toBeTruthy()

    const body = (await page.json()) as Session.GlobalInfo[]
    expect(body.map((session) => session.id)).toEqual([second.id])
    expect(body[0].project?.id).toBe(second.projectID)

    const next = await withExperimental(
      tmp.path,
      `/session?${new URLSearchParams({
        directory: tmp.path,
        limit: "10",
        cursor: body[0].time.updated.toString(),
      })}`,
    )
    expect(next.status).toBe(200)
    expect(((await next.json()) as Session.GlobalInfo[]).map((session) => session.id)).toContain(first.id)
  })

  testWorktreeMutations("serves worktree mutations", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const created = await withExperimental(tmp.path, "/worktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "api-test-legacy" }),
    })

    expect(created.status).toBe(200)
    const info = (await created.json()) as Worktree.Info
    expect(info).toMatchObject({ name: "api-test-legacy", branch: "physicscode/api-test-legacy" })
    await waitReady(info.directory)

    const listed = await withExperimental(tmp.path, "/worktree")
    expect(listed.status).toBe(200)
    expect(await listed.json()).toContain(info.directory)

    if (process.platform !== "win32") {
      const reset = await withExperimental(tmp.path, "/worktree/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: info.directory }),
      })

      expect(reset.status).toBe(200)
      expect(await reset.json()).toBe(true)
    }

    const removed = await withExperimental(tmp.path, "/worktree", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory: info.directory }),
    })

    expect(removed.status).toBe(200)
    expect(await removed.json()).toBe(true)

    const afterRemove = await withExperimental(tmp.path, "/worktree")
    expect(afterRemove.status).toBe(200)
    expect(await afterRemove.json()).toEqual([])
  })
})
