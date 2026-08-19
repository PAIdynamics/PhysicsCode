import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Todo } from "@/session/todo"
import { Bus } from "@/bus"
import { Session } from "@/session/session"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(Todo.defaultLayer, Bus.layer, Session.defaultLayer, CrossSpawnSpawner.defaultLayer))

// TodoTable.session_id has a foreign key to SessionTable.id, so every test
// needs a real session row, not just an arbitrary SessionID string.
const newSession = Effect.fn("TodoTest.newSession")(function* () {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Todo test" })
  return chat.id
})

describe("session.Todo", () => {
  it.live("get() returns an empty list before anything is written", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        const id = yield* newSession()
        expect(yield* todo.get(id)).toEqual([])
      }),
    ),
  )

  it.live("update() then get() round-trips todos in position order", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        const id = yield* newSession()
        const todos: Todo.Info[] = [
          { content: "first", status: "pending", priority: "high" },
          { content: "second", status: "in_progress", priority: "medium" },
        ]

        yield* todo.update({ sessionID: id, todos })

        expect(yield* todo.get(id)).toEqual(todos)
      }),
    ),
  )

  it.live("update() replaces the previous todo list rather than appending", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        const id = yield* newSession()

        yield* todo.update({ sessionID: id, todos: [{ content: "old", status: "pending", priority: "low" }] })
        yield* todo.update({ sessionID: id, todos: [{ content: "new", status: "pending", priority: "low" }] })

        expect(yield* todo.get(id)).toEqual([{ content: "new", status: "pending", priority: "low" }])
      }),
    ),
  )

  it.live("update() with an empty array clears the todo list", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        const id = yield* newSession()

        yield* todo.update({ sessionID: id, todos: [{ content: "old", status: "pending", priority: "low" }] })
        yield* todo.update({ sessionID: id, todos: [] })

        expect(yield* todo.get(id)).toEqual([])
      }),
    ),
  )

  it.live("update() publishes a Todo.Event.Updated bus event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const todo = yield* Todo.Service
        const id = yield* newSession()
        const todos: Todo.Info[] = [{ content: "event check", status: "pending", priority: "high" }]

        const received = Promise.withResolvers<{ sessionID: string; todos: Todo.Info[] }>()
        const unsub = yield* bus.subscribeCallback(Todo.Event.Updated, (event) =>
          received.resolve((event as any).properties),
        )

        yield* todo.update({ sessionID: id, todos })
        const payload = yield* Effect.promise(() => received.promise)

        expect(payload).toEqual({ sessionID: id, todos })
        unsub()
      }),
    ),
  )
})
