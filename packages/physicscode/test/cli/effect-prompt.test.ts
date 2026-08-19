import { describe, expect, mock, test } from "bun:test"
import { Effect, Option } from "effect"
import * as realPrompts from "@clack/prompts"

const calls: Array<{ fn: string; args: unknown[] }> = []
let selectResult: unknown = "picked"
let spinnerCalls: Array<{ fn: string; args: unknown[] }> = []

const CANCEL = Symbol("cancel")

// mock.module patches bun's shared module registry for the entire test
// process (not just this file), so every export not explicitly overridden
// here MUST pass through to the real module - otherwise any other test
// file that exercises an un-stubbed clack/prompts function (log.error,
// password, text, ...) breaks with "is not a function" once this file has
// loaded, regardless of test order.
void mock.module("@clack/prompts", () => ({
  ...realPrompts,
  intro: (...args: unknown[]) => calls.push({ fn: "intro", args }),
  outro: (...args: unknown[]) => calls.push({ fn: "outro", args }),
  log: {
    ...realPrompts.log,
    info: (...args: unknown[]) => calls.push({ fn: "log.info", args }),
  },
  select: async (...args: unknown[]) => {
    calls.push({ fn: "select", args })
    return selectResult
  },
  isCancel: (value: unknown) => value === CANCEL,
  spinner: () => ({
    start: (...args: unknown[]) => spinnerCalls.push({ fn: "start", args }),
    stop: (...args: unknown[]) => spinnerCalls.push({ fn: "stop", args }),
  }),
}))

const Prompt = await import("@/cli/effect/prompt")

describe("cli.effect.Prompt", () => {
  test("intro/outro/log.info synchronously delegate to @clack/prompts", async () => {
    calls.length = 0
    await Effect.runPromise(Prompt.intro("hello"))
    await Effect.runPromise(Prompt.outro("bye"))
    await Effect.runPromise(Prompt.log.info("info message"))

    expect(calls).toEqual([
      { fn: "intro", args: ["hello"] },
      { fn: "outro", args: ["bye"] },
      { fn: "log.info", args: ["info message"] },
    ])
  })

  test("select resolves to Option.some on a real answer", async () => {
    selectResult = "chosen-value"
    const result = await Effect.runPromise(Prompt.select({ message: "pick one", options: [] } as any))
    expect(result).toEqual(Option.some("chosen-value"))
  })

  test("select resolves to Option.none when cancelled", async () => {
    selectResult = CANCEL
    const result = await Effect.runPromise(Prompt.select({ message: "pick one", options: [] } as any))
    expect(result).toEqual(Option.none())
  })

  test("spinner start/stop delegate to the underlying clack spinner", async () => {
    spinnerCalls = []
    const s = Prompt.spinner()
    await Effect.runPromise(s.start("working..."))
    await Effect.runPromise(s.stop("done", 0))

    expect(spinnerCalls).toEqual([
      { fn: "start", args: ["working..."] },
      { fn: "stop", args: ["done", 0] },
    ])
  })
})
