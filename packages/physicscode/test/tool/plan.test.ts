import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Provider } from "@/provider/provider"
import { Question } from "../../src/question"
import { MessageID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { Truncate } from "@/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Provider.defaultLayer,
    Question.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const ctx = (sessionID: SessionID) => ({
  sessionID,
  messageID: MessageID.make("msg_call"),
  callID: "call_1",
  agent: "plan",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const pending = Effect.fn("PlanExitToolTest.pending")(function* (question: Question.Interface) {
  for (;;) {
    const items = yield* question.list()
    const item = items[0]
    if (item) return item
    yield* Effect.sleep("10 millis")
  }
})

const seedUserMessage = Effect.fn("PlanExitToolTest.seed")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "plan",
    model: ref,
    time: { created: Date.now() },
  })
})

describe("tool.plan_exit", () => {
  it.live("switching to build agent on 'Yes' adds a new user message with the prior model", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Plan session" })
        yield* seedUserMessage(chat.id)

        const toolInfo = yield* PlanExitTool
        const tool = yield* toolInfo.init()

        const fiber = yield* tool.execute({}, ctx(chat.id)).pipe(Effect.forkScoped)
        const item = yield* pending(question)
        yield* question.reply({ requestID: item.id, answers: [["Yes"]] })

        const result = yield* Fiber.join(fiber)
        expect(result.title).toBe("Switching to build agent")
        expect(result.output).toContain("approved switching to build agent")

        const messages = [...MessageV2.stream(chat.id)]
        const added = messages.find((m) => m.info.role === "user" && m.info.agent === "build")
        expect(added).toBeDefined()
        expect((added!.info as MessageV2.User).model).toEqual(ref)

        const addedParts = added!.parts
        expect(addedParts.some((p) => p.type === "text" && p.text.includes("has been approved"))).toBe(true)
      }),
    ),
  )

  it.live("declining with 'No' rejects the tool call", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Plan session" })
        yield* seedUserMessage(chat.id)

        const toolInfo = yield* PlanExitTool
        const tool = yield* toolInfo.init()

        const fiber = yield* tool.execute({}, ctx(chat.id)).pipe(Effect.forkScoped)
        const item = yield* pending(question)
        yield* question.reply({ requestID: item.id, answers: [["No"]] })

        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  )
})
