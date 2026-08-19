import { describe, expect, test } from "bun:test"
import { SyncRoutes } from "@/server/routes/instance/sync"
import { Database } from "@/storage/db"
import { EventTable } from "@/sync/event.sql"
import { EventSequenceTable } from "@/sync/event.sql"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function insertEvent(id: string, aggregateID: string, seq: number) {
  Database.use((db) => {
    db.insert(EventSequenceTable).values({ aggregate_id: aggregateID, seq }).onConflictDoUpdate({
      target: EventSequenceTable.aggregate_id,
      set: { seq },
    }).run()
    db.insert(EventTable)
      .values({ id, aggregate_id: aggregateID, seq, type: "test.event", data: { n: seq } })
      .run()
  })
}

describe("server.routes.instance.SyncRoutes", () => {
  test("POST /history returns all events when the client has no known state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agg = `agg-${crypto.randomUUID()}`
        insertEvent(`ev-${crypto.randomUUID()}`, agg, 1)
        insertEvent(`ev-${crypto.randomUUID()}`, agg, 2)

        const res = await SyncRoutes().fetch(
          new Request("http://localhost/history", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          }),
        )
        expect(res.status).toBe(200)
        const rows = (await res.json()) as Array<{ aggregate_id: string; seq: number }>
        expect(rows.filter((r) => r.aggregate_id === agg).map((r) => r.seq)).toEqual([1, 2])
      },
    })
  })

  test("POST /history excludes events at or below the client's known sequence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agg = `agg-${crypto.randomUUID()}`
        insertEvent(`ev-${crypto.randomUUID()}`, agg, 1)
        insertEvent(`ev-${crypto.randomUUID()}`, agg, 2)
        insertEvent(`ev-${crypto.randomUUID()}`, agg, 3)

        const res = await SyncRoutes().fetch(
          new Request("http://localhost/history", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ [agg]: 1 }),
          }),
        )
        expect(res.status).toBe(200)
        const rows = (await res.json()) as Array<{ aggregate_id: string; seq: number }>
        expect(rows.filter((r) => r.aggregate_id === agg).map((r) => r.seq)).toEqual([2, 3])
      },
    })
  })

  test("POST /history rejects a non-numeric sequence value", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await SyncRoutes().fetch(
          new Request("http://localhost/history", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agg: "not-a-number" }),
          }),
        )
        expect(res.status).toBe(400)
      },
    })
  })

  test("POST /start kicks off syncing and returns true", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await SyncRoutes().fetch(new Request("http://localhost/start", { method: "POST" }))
        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
      },
    })
  })

  test("POST /replay rejects an empty events array", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await SyncRoutes().fetch(
          new Request("http://localhost/replay", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ directory: tmp.path, events: [] }),
          }),
        )
        expect(res.status).toBe(400)
      },
    })
  })
})
