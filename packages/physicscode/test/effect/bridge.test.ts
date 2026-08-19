import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Instance } from "../../src/project/instance"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import type { WorkspaceID } from "@/control-plane/schema"
import { tmpdir } from "../fixture/fixture"

describe("effect.EffectBridge", () => {
  test("promise() restores instance context (ALS) when only an instance is active", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bridge = await Effect.runPromise(EffectBridge.make())
        const directory = await bridge.promise(
          Effect.sync(() => Instance.directory),
        )
        expect(directory).toBe(Instance.directory)
      },
    })
  })

  test("promise() restores workspace context (ALS) when only a workspace is active, no instance", async () => {
    const workspaceID = "ws_bridge_test" as WorkspaceID

    await WorkspaceContext.provide({
      workspaceID,
      fn: async () => {
        const bridge = await Effect.runPromise(EffectBridge.make())
        const seen = await bridge.promise(Effect.sync(() => WorkspaceContext.workspaceID))
        expect(seen).toBe(workspaceID)
      },
    })
  })

  test("promise() restores both instance and workspace context together", async () => {
    await using tmp = await tmpdir()
    const workspaceID = "ws_bridge_both" as WorkspaceID

    await WorkspaceContext.provide({
      workspaceID,
      fn: async () => {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bridge = await Effect.runPromise(EffectBridge.make())
            const result = await bridge.promise(
              Effect.sync(() => ({ directory: Instance.directory, workspaceID: WorkspaceContext.workspaceID })),
            )
            expect(result).toEqual({ directory: Instance.directory, workspaceID })
          },
        })
      },
    })
  })

  test("make() tolerates having neither instance nor workspace context active", async () => {
    const bridge = await Effect.runPromise(EffectBridge.make())
    const result = await bridge.promise(Effect.succeed("no context needed"))
    expect(result).toBe("no context needed")
  })

  test("run() resolves with the effect's success value", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bridge = await Effect.runPromise(EffectBridge.make())
        const result = await Effect.runPromise(bridge.run(Effect.succeed(42)))
        expect(result).toBe(42)
      },
    })
  })

  test("run() fails with the effect's own failure, restoring context first", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bridge = await Effect.runPromise(EffectBridge.make())
        const exit = await Effect.runPromiseExit(
          bridge.run(
            Effect.gen(function* () {
              // Confirms context really is restored inside run(), not just promise()/fork().
              expect(Instance.directory).toBe(tmp.path)
              return yield* Effect.fail("boom")
            }),
          ),
        )
        expect(exit._tag).toBe("Failure")
      },
    })
  })

  test("fork() runs the effect with restored instance context", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bridge = await Effect.runPromise(EffectBridge.make())
        const fiber = bridge.fork(Effect.sync(() => Instance.directory))
        const result = await Effect.runPromise(Fiber.join(fiber))
        expect(result).toBe(tmp.path)
      },
    })
  })
})
