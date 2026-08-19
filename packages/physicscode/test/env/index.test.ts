import { describe } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { Env } from "@/env"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Env.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("env.Env", () => {
  it.live("all() starts from a snapshot of process.env", () =>
    provideTmpdirInstance((_root) =>
      Effect.gen(function* () {
        const svc = yield* Env.Service
        const snapshot = yield* svc.all()
        const key = Object.keys(process.env)[0]
        if (key) {
          if (snapshot[key] !== process.env[key]) throw new Error("expected a snapshot of process.env")
        }
      }),
    ),
  )

  it.live("get() reads a value from the snapshot", () =>
    provideTmpdirInstance((_root) =>
      Effect.gen(function* () {
        const svc = yield* Env.Service
        yield* svc.set("PHYSICSCODE_TEST_ENV_KEY", "one")
        const value = yield* svc.get("PHYSICSCODE_TEST_ENV_KEY")
        if (value !== "one") throw new Error(`expected "one", got ${value}`)
      }),
    ),
  )

  it.live("get() returns undefined for a key that was never set", () =>
    provideTmpdirInstance((_root) =>
      Effect.gen(function* () {
        const svc = yield* Env.Service
        const value = yield* svc.get("PHYSICSCODE_TEST_ENV_MISSING_KEY")
        if (value !== undefined) throw new Error(`expected undefined, got ${value}`)
      }),
    ),
  )

  it.live("set() overwrites an existing value without mutating process.env", () =>
    provideTmpdirInstance((_root) =>
      Effect.gen(function* () {
        const svc = yield* Env.Service
        yield* svc.set("PHYSICSCODE_TEST_ENV_KEY", "a")
        yield* svc.set("PHYSICSCODE_TEST_ENV_KEY", "b")
        const value = yield* svc.get("PHYSICSCODE_TEST_ENV_KEY")
        if (value !== "b") throw new Error(`expected "b", got ${value}`)
        if (process.env["PHYSICSCODE_TEST_ENV_KEY"] !== undefined) {
          throw new Error("set() must not mutate the real process.env")
        }
      }),
    ),
  )

  it.live("remove() deletes a key from the snapshot", () =>
    provideTmpdirInstance((_root) =>
      Effect.gen(function* () {
        const svc = yield* Env.Service
        yield* svc.set("PHYSICSCODE_TEST_ENV_KEY", "one")
        yield* svc.remove("PHYSICSCODE_TEST_ENV_KEY")
        const value = yield* svc.get("PHYSICSCODE_TEST_ENV_KEY")
        if (value !== undefined) throw new Error(`expected undefined after remove, got ${value}`)
      }),
    ),
  )
})
