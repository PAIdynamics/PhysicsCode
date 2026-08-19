import { describe, expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { CANCEL, clackMock, resetClackMock } from "../lib/clack-mock"

const Prompt = await import("@/cli/effect/prompt")

describe("cli.effect.Prompt", () => {
  test("intro/outro/log.info synchronously delegate to @clack/prompts", async () => {
    resetClackMock()
    await Effect.runPromise(Prompt.intro("hello"))
    await Effect.runPromise(Prompt.outro("bye"))
    await Effect.runPromise(Prompt.log.info("info message"))

    expect(clackMock.calls).toEqual([
      { fn: "intro", args: ["hello"] },
      { fn: "outro", args: ["bye"] },
      { fn: "log.info", args: ["info message"] },
    ])
  })

  test("select resolves to Option.some on a real answer", async () => {
    resetClackMock()
    clackMock.selectResult = "chosen-value"
    const result = await Effect.runPromise(Prompt.select({ message: "pick one", options: [] } as any))
    expect(result).toEqual(Option.some("chosen-value"))
  })

  test("select resolves to Option.none when cancelled", async () => {
    resetClackMock()
    clackMock.selectResult = CANCEL
    const result = await Effect.runPromise(Prompt.select({ message: "pick one", options: [] } as any))
    expect(result).toEqual(Option.none())
  })

  test("spinner start/stop delegate to the underlying clack spinner", async () => {
    resetClackMock()
    const s = Prompt.spinner()
    await Effect.runPromise(s.start("working..."))
    await Effect.runPromise(s.stop("done", 0))

    expect(clackMock.spinnerCalls).toEqual([
      { fn: "start", args: ["working..."] },
      { fn: "stop", args: ["done", 0] },
    ])
  })
})
