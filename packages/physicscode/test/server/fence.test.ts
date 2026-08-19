import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as Fence from "@/server/fence"
import { Database } from "@/storage/db"
import { EventSequenceTable } from "@/sync/event.sql"
import { Workspace } from "@/control-plane/workspace"
import type { WorkspaceID } from "@/control-plane/schema"

describe("server.Fence.parse", () => {
  test("parses a valid JSON state header", () => {
    const headers = new Headers({ "x-physicscode-sync": JSON.stringify({ "sess-1": 3, "sess-2": 7 }) })
    expect(Fence.parse(headers)).toEqual({ "sess-1": 3, "sess-2": 7 })
  })

  test("returns undefined when the header is absent", () => {
    expect(Fence.parse(new Headers())).toBeUndefined()
  })

  test("returns undefined for malformed JSON", () => {
    const headers = new Headers({ "x-physicscode-sync": "{not json" })
    expect(Fence.parse(headers)).toBeUndefined()
  })

  test("returns undefined for a JSON value that isn't an object", () => {
    expect(Fence.parse(new Headers({ "x-physicscode-sync": "42" }))).toBeUndefined()
    expect(Fence.parse(new Headers({ "x-physicscode-sync": "null" }))).toBeUndefined()
    expect(Fence.parse(new Headers({ "x-physicscode-sync": '"str"' }))).toBeUndefined()
  })

  test("drops entries whose sequence isn't an integer", () => {
    const headers = new Headers({
      "x-physicscode-sync": JSON.stringify({ good: 5, bad: 1.5, alsoBad: "5" }),
    })
    expect(Fence.parse(headers)).toEqual({ good: 5 })
  })
})

describe("server.Fence.diff", () => {
  test("includes ids whose sequence changed", () => {
    expect(Fence.diff({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  test("excludes ids whose sequence is unchanged", () => {
    expect(Fence.diff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: 3 })
  })

  test("includes new ids not present in prev, using -1 as the baseline", () => {
    expect(Fence.diff({}, { a: 0 })).toEqual({ a: 0 })
  })

  test("includes ids that disappeared in next as -1", () => {
    expect(Fence.diff({ a: 5 }, {})).toEqual({ a: -1 })
  })

  test("returns an empty diff for identical states", () => {
    expect(Fence.diff({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual({})
  })

  test("returns an empty diff for two empty states", () => {
    expect(Fence.diff({}, {})).toEqual({})
  })
})

describe("server.Fence.load", () => {
  test("returns all rows as an aggregate_id -> seq map", () => {
    const a = `agg-${crypto.randomUUID()}`
    const b = `agg-${crypto.randomUUID()}`
    Database.use((db) =>
      db.insert(EventSequenceTable).values([
        { aggregate_id: a, seq: 3 },
        { aggregate_id: b, seq: 9 },
      ]).run(),
    )

    const result = Fence.load()
    expect(result[a]).toBe(3)
    expect(result[b]).toBe(9)
  })

  test("filters to the given ids when provided", () => {
    const a = `agg-${crypto.randomUUID()}`
    const b = `agg-${crypto.randomUUID()}`
    Database.use((db) =>
      db.insert(EventSequenceTable).values([
        { aggregate_id: a, seq: 1 },
        { aggregate_id: b, seq: 2 },
      ]).run(),
    )

    const result = Fence.load([a])
    expect(result).toEqual({ [a]: 1 })
  })

  test("treats an empty ids array the same as no filter at all (falsy length check)", () => {
    const a = `agg-${crypto.randomUUID()}`
    Database.use((db) => db.insert(EventSequenceTable).values({ aggregate_id: a, seq: 1 }).run())

    // load()'s `!ids?.length` guard means an empty array and `undefined`
    // both fall through to "return every row" - not "return nothing".
    expect(Fence.load([])[a]).toBe(1)
  })
})

describe("server.Fence.wait", () => {
  test("delegates to Workspace.waitForSync with the given state and signal", async () => {
    const calls: Array<{ workspaceID: string; state: Record<string, number>; signal?: AbortSignal }> = []
    const workspaceLayer = Layer.succeed(
      Workspace.Service,
      Workspace.Service.of({
        waitForSync: (workspaceID: WorkspaceID, state: Record<string, number>, signal?: AbortSignal) => {
          calls.push({ workspaceID, state, signal })
          return Effect.void
        },
      } as any),
    )

    const controller = new AbortController()
    await Effect.runPromise(
      Fence.waitEffect("ws_1" as WorkspaceID, { a: 1 }, controller.signal).pipe(Effect.provide(workspaceLayer)),
    )

    expect(calls).toEqual([{ workspaceID: "ws_1", state: { a: 1 }, signal: controller.signal }])
  })
})

describe("server.Fence.FenceMiddleware", () => {
  function fakeContext(method: string) {
    const headers = new Headers()
    return {
      req: { method },
      res: { headers },
    } as any
  }

  test("skips diffing entirely for GET/HEAD/OPTIONS requests", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const c = fakeContext(method)
      let nextCalled = false
      await Fence.FenceMiddleware(c, async () => {
        nextCalled = true
      })
      expect(nextCalled).toBe(true)
      expect(c.res.headers.get("x-physicscode-sync")).toBeNull()
    }
  })

  test("sets the sync header when a write request changes sequence state", async () => {
    const agg = `agg-${crypto.randomUUID()}`
    Database.use((db) => db.insert(EventSequenceTable).values({ aggregate_id: agg, seq: 1 }).run())

    const c = fakeContext("POST")
    await Fence.FenceMiddleware(c, async () => {
      Database.use((db) =>
        db
          .update(EventSequenceTable)
          .set({ seq: 2 })
          .where(eq(EventSequenceTable.aggregate_id, agg))
          .run(),
      )
    })

    const header = c.res.headers.get("x-physicscode-sync")
    expect(header).not.toBeNull()
    expect(JSON.parse(header!)).toEqual({ [agg]: 2 })
  })

  test("does not set the sync header when nothing changed during the request", async () => {
    const c = fakeContext("POST")
    await Fence.FenceMiddleware(c, async () => {})
    expect(c.res.headers.get("x-physicscode-sync")).toBeNull()
  })
})
