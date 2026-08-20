import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@physicscode-ai/core/flag/flag"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Question } from "@/question"
import type { QuestionID } from "@/question/schema"
import { Server } from "@/server/server"
import { SessionID } from "@/session/schema"
import { tmpdir } from "../fixture/fixture"

// Integration coverage for the questionHandlers HttpApiBuilder wiring in
// src/server/routes/instance/httpapi/handlers/question.ts - that file is
// pure route registration (list/reply/reject delegating straight to
// Question.Service), so it's only meaningfully exercised by hitting the
// real in-process server rather than by unit-testing it in isolation.
// This is the reusable pattern for the sibling httpapi/handlers/*.ts
// files: set PHYSICSCODE_EXPERIMENTAL_HTTPAPI so Server.Default() picks
// the effect-httpapi backend, then drive it with app.request(...) using
// the x-physicscode-directory header the InstanceContextMiddleware reads.

const original = Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

function ask(directory: string, questions: ReadonlyArray<Question.Info>) {
  return Instance.provide({
    directory,
    fn: () => AppRuntime.runPromise(Question.Service.use((svc) => svc.ask({ sessionID: SessionID.make("ses_test"), questions }))),
  })
}

function question(overrides: Partial<Question.Info> = {}): Question.Info {
  return {
    question: "What would you like to do?",
    header: "Action",
    options: [
      { label: "Option 1", description: "First option" },
      { label: "Option 2", description: "Second option" },
    ],
    ...overrides,
  }
}

afterEach(async () => {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
})

describe("question HttpApi", () => {
  test("GET /question lists pending questions for the directory", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path, [question()])
    // ask() blocks on a Deferred until reply/reject - don't await yet, just
    // give the fiber a tick to register the pending entry.
    await new Promise((r) => setTimeout(r, 20))

    const res = await app().request("/question", { headers: { "x-physicscode-directory": tmp.path } })
    expect(res.status).toBe(200)
    const list = (await res.json()) as Array<{ id: string; questions: Question.Info[] }>
    expect(list).toHaveLength(1)
    expect(list[0].questions[0].question).toBe("What would you like to do?")

    // clean up the still-pending fiber
    const requestID = list[0].id as unknown as QuestionID
    await Instance.provide({
      directory: tmp.path,
      fn: () => AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(requestID))),
    })
    await pending.catch(() => {})
  })

  test("POST /question/:requestID/reply answers the question and resolves ask()", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path, [question()])
    await new Promise((r) => setTimeout(r, 20))

    const listRes = await app().request("/question", { headers: { "x-physicscode-directory": tmp.path } })
    const [entry] = (await listRes.json()) as Array<{ id: string }>

    const replyRes = await app().request(`/question/${entry.id}/reply`, {
      method: "POST",
      headers: { "x-physicscode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ answers: [["Option 1"]] }),
    })
    expect(replyRes.status).toBe(200)
    expect(await replyRes.json()).toBe(true)

    const answers = await pending
    expect(answers).toEqual([["Option 1"]])
  })

  test("POST /question/:requestID/reject rejects the pending ask()", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path, [question()])
    await new Promise((r) => setTimeout(r, 20))

    const listRes = await app().request("/question", { headers: { "x-physicscode-directory": tmp.path } })
    const [entry] = (await listRes.json()) as Array<{ id: string }>

    const rejectRes = await app().request(`/question/${entry.id}/reject`, {
      method: "POST",
      headers: { "x-physicscode-directory": tmp.path },
    })
    expect(rejectRes.status).toBe(200)
    expect(await rejectRes.json()).toBe(true)

    await expect(pending).rejects.toThrow()
  })

  test("GET /question returns an empty list for a directory with no pending questions", async () => {
    await using tmp = await tmpdir()
    const res = await app().request("/question", { headers: { "x-physicscode-directory": tmp.path } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
