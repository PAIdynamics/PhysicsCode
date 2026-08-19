import { beforeAll, describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber } from "effect"
import { AppRuntime } from "@/effect/app-runtime"

// AppRuntime.dispose() is intentionally never exercised here: it tears down
// the process-wide shared runtime that every other test file's AppRuntime
// calls depend on.
describe("effect.AppRuntime", () => {
  // runSync requires the ManagedRuntime's context to already be built, which
  // only happens after an async run (e.g. runPromise) has resolved it once.
  beforeAll(async () => {
    await AppRuntime.runPromise(Effect.succeed(undefined))
  })

  test("runSync executes an effect synchronously", () => {
    expect(AppRuntime.runSync(Effect.succeed(42))).toBe(42)
  })

  test("runSync rethrows on a failed effect", () => {
    expect(() => AppRuntime.runSync(Effect.fail(new Error("boom")))).toThrow()
  })

  test("runPromiseExit resolves with a Success exit", async () => {
    const exit = await AppRuntime.runPromiseExit(Effect.succeed("ok"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBe("ok")
  })

  test("runPromiseExit resolves with a Failure exit on error", async () => {
    const exit = await AppRuntime.runPromiseExit(Effect.fail("nope"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("runFork returns a fiber that can be joined for the result", async () => {
    const fiber = AppRuntime.runFork(Effect.succeed("forked"))
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBe("forked")
  })

  test("runCallback invokes onExit with the effect's result", async () => {
    const result = await new Promise<Exit.Exit<string, unknown>>((resolve) => {
      AppRuntime.runCallback(Effect.succeed("called-back"), {
        onExit: (exit) => resolve(exit),
      })
    })
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) expect(result.value).toBe("called-back")
  })
})
