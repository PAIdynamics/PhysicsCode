import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { TodoWriteTool } from "@/tool/todo"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"
import type { Permission } from "@/permission"
import type { Tool } from "@/tool/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Todo.defaultLayer,
    Truncate.defaultLayer,
  ),
)

function makeCtx(sessionID: SessionID) {
  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx: Tool.Context = {
    sessionID,
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  return { requests, ctx }
}

describe("tool.todowrite", () => {
  it.live("asks for todowrite permission and persists the todos", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const todo = yield* Todo.Service
        const chat = yield* sessions.create({ title: "Todo tool test" })
        const { requests, ctx } = makeCtx(chat.id)

        const toolInfo = yield* TodoWriteTool
        const tool = yield* toolInfo.init()

        const todos = [
          { content: "first", status: "pending", priority: "high" },
          { content: "second", status: "completed", priority: "low" },
        ]
        const result = yield* tool.execute({ todos }, ctx)

        expect(requests).toEqual([{ permission: "todowrite", patterns: ["*"], always: ["*"], metadata: {} }])
        expect(yield* todo.get(chat.id)).toEqual(todos)
        expect(result.metadata.todos).toEqual(todos)
      }),
    ),
  )

  it.live("titles the result with the count of non-completed todos", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Todo tool test" })
        const { ctx } = makeCtx(chat.id)

        const toolInfo = yield* TodoWriteTool
        const tool = yield* toolInfo.init()

        const todos = [
          { content: "a", status: "pending", priority: "high" },
          { content: "b", status: "in_progress", priority: "medium" },
          { content: "c", status: "completed", priority: "low" },
        ]
        const result = yield* tool.execute({ todos }, ctx)

        expect(result.title).toBe("2 todos")
      }),
    ),
  )

  it.live("outputs the todos as pretty-printed JSON", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Todo tool test" })
        const { ctx } = makeCtx(chat.id)

        const toolInfo = yield* TodoWriteTool
        const tool = yield* toolInfo.init()

        const todos = [{ content: "solo", status: "pending", priority: "high" }]
        const result = yield* tool.execute({ todos }, ctx)

        expect(result.output).toBe(JSON.stringify(todos, null, 2))
      }),
    ),
  )

  it.live("all-completed todos title as '0 todos'", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Todo tool test" })
        const { ctx } = makeCtx(chat.id)

        const toolInfo = yield* TodoWriteTool
        const tool = yield* toolInfo.init()

        const todos = [{ content: "done", status: "completed", priority: "low" }]
        const result = yield* tool.execute({ todos }, ctx)

        expect(result.title).toBe("0 todos")
      }),
    ),
  )
})
