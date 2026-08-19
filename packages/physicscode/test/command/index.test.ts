import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Command } from "@/command"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("command.hints", () => {
  test("extracts numbered positional placeholders in sorted order", () => {
    expect(Command.hints("do $2 then $1")).toEqual(["$1", "$2"])
  })

  test("deduplicates repeated numbered placeholders", () => {
    expect(Command.hints("$1 and $1 again")).toEqual(["$1"])
  })

  test("appends $ARGUMENTS when present", () => {
    expect(Command.hints("run with $ARGUMENTS")).toEqual(["$ARGUMENTS"])
  })

  test("combines numbered placeholders and $ARGUMENTS", () => {
    expect(Command.hints("$1 then $ARGUMENTS")).toEqual(["$1", "$ARGUMENTS"])
  })

  test("returns an empty array when there are no placeholders", () => {
    expect(Command.hints("plain template text")).toEqual([])
  })
})

describe("command.Command.Service", () => {
  it.live("list() includes the four built-in default commands", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const service = yield* Command.Service
        const commands = yield* service.list()
        const names = commands.map((c) => c.name)

        expect(names).toContain(Command.Default.INIT)
        expect(names).toContain(Command.Default.REVIEW)
        expect(names).toContain(Command.Default.SCIENCE)
        expect(names).toContain(Command.Default.SCIENCE_OFF)
      }),
    ),
  )

  it.live("get() returns a single command by name with its source", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const service = yield* Command.Service
        const review = yield* service.get(Command.Default.REVIEW)

        expect(review?.source).toBe("command")
        expect(review?.subtask).toBe(true)
      }),
    ),
  )

  it.live("built-in commands expose a non-empty template string", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const service = yield* Command.Service
        const init = yield* service.get(Command.Default.INIT)
        const review = yield* service.get(Command.Default.REVIEW)
        const science = yield* service.get(Command.Default.SCIENCE)
        const scienceOff = yield* service.get(Command.Default.SCIENCE_OFF)

        for (const command of [init, review, science, scienceOff]) {
          expect(typeof command?.template).toBe("string")
          expect((command?.template as string).length).toBeGreaterThan(0)
        }
      }),
    ),
  )

  it.live("get() returns undefined for an unknown command", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const service = yield* Command.Service
        expect(yield* service.get("does-not-exist")).toBeUndefined()
      }),
    ),
  )

  it.live("custom commands from config appear alongside the built-ins", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const service = yield* Command.Service
          const custom = yield* service.get("my-custom-command")

          expect(custom).toBeDefined()
          expect(custom?.source).toBe("command")
          expect(custom?.agent).toBe("build")
          expect(custom?.template).toBe("do the $1 thing")
          expect(custom?.hints).toEqual(["$1"])
        }),
      {
        config: {
          command: {
            "my-custom-command": {
              agent: "build",
              description: "a custom test command",
              template: "do the $1 thing",
            },
          },
        },
      },
    ),
  )
})
