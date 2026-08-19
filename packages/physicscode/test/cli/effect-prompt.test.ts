import { describe, expect, mock, test } from "bun:test"
import { Effect, Option } from "effect"

const calls: Array<{ fn: string; args: unknown[] }> = []
let selectResult: unknown = "picked"
let spinnerCalls: Array<{ fn: string; args: unknown[] }> = []

const CANCEL = Symbol("cancel")

void mock.module("@clack/prompts", () => ({
  intro: (...args: unknown[]) => calls.push({ fn: "intro", args }),
  outro: (...args: unknown[]) => calls.push({ fn: "outro", args }),
  log: {
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
