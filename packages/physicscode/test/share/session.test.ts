import { describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import * as ShareNext from "@/share/share-next"
import { SyncEvent } from "@/sync"
import { Config } from "@/config/config"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const notImplemented = (name: string) => () => Effect.die(new Error(`not implemented in fake: ${name}`))

// Mutable so individual tests can swap behavior without rebuilding the
// (memoized) layer graph - SessionShare.layer resolves its ShareNext.Service
// dependency once at layer-construction time, so a fresh per-test Layer with
// different overrides doesn't reliably take effect once the outer testEffect
// layer is already built.
const shareNextImpl: { -readonly [K in keyof ShareNext.Interface]: ShareNext.Interface[K] } = {
  init: notImplemented("init"),
  url: notImplemented("url"),
  request: notImplemented("request"),
  create: notImplemented("create"),
  remove: notImplemented("remove"),
}

function resetShareNextImpl() {
  shareNextImpl.init = notImplemented("init")
  shareNextImpl.url = notImplemented("url")
  shareNextImpl.request = notImplemented("request")
  shareNextImpl.create = notImplemented("create")
  shareNextImpl.remove = notImplemented("remove")
}

const fakeShareNext = Layer.succeed(
  ShareNext.Service,
  ShareNext.Service.of({
    init: (...args) => shareNextImpl.init(...args),
    url: (...args) => shareNextImpl.url(...args),
    request: (...args) => shareNextImpl.request(...args),
    create: (...args) => shareNextImpl.create(...args),
    remove: (...args) => shareNextImpl.remove(...args),
  }),
)

const fakeSync = Layer.succeed(
  SyncEvent.Service,
  SyncEvent.Service.of({
    run: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
  }),
)

const testLayer = Layer.merge(
  SessionShare.layer.pipe(
    Layer.provide(fakeShareNext),
    Layer.provide(fakeSync),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
  ),
  CrossSpawnSpawner.defaultLayer,
)

const it = testEffect(testLayer)

describe("share.SessionShare", () => {
  it.live("share() throws when sharing is disabled in config", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          resetShareNextImpl()
          // The implementation does a plain `throw` (not Effect.fail), so it
          // surfaces as a defect - assert via the Exit's cause, not flip().
          const exit = yield* Effect.exit(SessionShare.Service.use((svc) => svc.share("ses_1" as SessionID)))
          expect(exit._tag).toBe("Failure")
          if (exit._tag === "Failure") {
            expect(String(Cause.squash(exit.cause))).toContain("Sharing is disabled")
          }
        }),
      { git: true, config: { share: "disabled" } },
    ),
  )

  it.live("create() does not auto-share when share mode is manual", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          resetShareNextImpl()
          let shareCalled = false
          shareNextImpl.create = () => {
            shareCalled = true
            return Effect.succeed({ url: "https://example.com/s/1" } as any)
          }
          const info = yield* SessionShare.Service.use((svc) => svc.create())
          expect(info.id).toBeTruthy()
          // Give any forked auto-share fiber a chance to run before asserting.
          yield* Effect.sleep("20 millis")
          expect(shareCalled).toBe(false)
        }),
      { git: true, config: { share: "manual" } },
    ),
  )

  it.live("create() auto-shares a new top-level session when share mode is auto", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          resetShareNextImpl()
          let sharedSessionID: string | undefined
          shareNextImpl.create = (sessionID) => {
            sharedSessionID = sessionID
            return Effect.succeed({ url: "https://example.com/s/1" } as any)
          }
          const info = yield* SessionShare.Service.use((svc) => svc.create())
          yield* Effect.sleep("100 millis")
          expect(sharedSessionID).toBe(info.id)
        }),
      { git: true, config: { share: "auto" } },
    ),
  )

  it.live("create() does not auto-share a child session (has a parentID)", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          resetShareNextImpl()
          const shareCalls: string[] = []
          shareNextImpl.create = (sessionID) => {
            shareCalls.push(sessionID)
            return Effect.succeed({ url: "https://example.com/s/1" } as any)
          }
          const parent = yield* SessionShare.Service.use((svc) => svc.create())
          const child = yield* SessionShare.Service.use((svc) => svc.create({ parentID: parent.id }))
          expect(child.parentID).toBe(parent.id)
          yield* Effect.sleep("100 millis")
          // Only the parent create() should have triggered an auto-share.
          expect(shareCalls).toEqual([parent.id])
        }),
      { git: true, config: { share: "auto" } },
    ),
  )

  it.live("unshare() calls ShareNext.remove", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          resetShareNextImpl()
          let removedID: string | undefined
          shareNextImpl.remove = (sessionID) => {
            removedID = sessionID
            return Effect.void
          }
          yield* SessionShare.Service.use((svc) => svc.unshare("ses_1" as SessionID))
          expect(removedID).toBe("ses_1")
        }),
      { git: true },
    ),
  )
})
