import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Question } from "@/question"
import type { QuestionID } from "@/question/schema"
import { QuestionRoutes } from "@/server/routes/instance/question"
import { SessionID } from "@/session/schema"
import { tmpdir } from "../fixture/fixture"

function ask(directory: string, questions: ReadonlyArray<Question.Info>) {
  return Instance.provide({
    directory,
    fn: () =>
      AppRuntime.runPromise(Question.Service.use((svc) => svc.ask({ sessionID: SessionID.make("ses_test"), questions }))),
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
  await Instance.disposeAll()
})

describe("legacy QuestionRoutes", () => {
  test("GET / lists pending questions for the directory", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path, [question()])
    await new Promise((r) => setTimeout(r, 20))

    const res = await Instance.provide({
      directory: tmp.path,
      fn: () => QuestionRoutes().request("/"),
    })
    expect(res.status).toBe(200)
    const list = (await res.json()) as Array<{ id: string; questions: Question.Info[] }>
    expect(list).toHaveLength(1)
    expect(list[0].questions[0].question).toBe("What would you like to do?")

    const requestID = list[0].id as unknown as QuestionID
    await Instance.provide({
      directory: tmp.path,
      fn: () => AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(requestID))),
    })
    await pending.catch(() => {})
  })

  test("POST /:requestID/reply answers the question and resolves ask()", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path, [question()])
    await new Promise((r) => setTimeout(r, 20))

    const [entry] = await Instance.provide({
      directory: tmp.path,
      fn: async () => (await (await QuestionRoutes().request("/")).json()) as Array<{ id: string }>,
    })

    const replyRes = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        QuestionRoutes().request(`/${entry.id}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: [["Option 1"]] }),
        }),
    })
    expect(replyRes.status).toBe(200)
    expect(await replyRes.json()).toBe(true)

    const answers = await pending
    expect(answers).toEqual([["Option 1"]])
  })

  test("POST /:requestID/reject rejects the pending ask()", async () => {
    await using tmp = await tmpdir()
    const pending = ask(tmp.path, [question()])
    await new Promise((r) => setTimeout(r, 20))

    const [entry] = await Instance.provide({
      directory: tmp.path,
      fn: async () => (await (await QuestionRoutes().request("/")).json()) as Array<{ id: string }>,
    })

    const rejectRes = await Instance.provide({
      directory: tmp.path,
      fn: () => QuestionRoutes().request(`/${entry.id}/reject`, { method: "POST" }),
    })
    expect(rejectRes.status).toBe(200)
    expect(await rejectRes.json()).toBe(true)

    await expect(pending).rejects.toThrow()
  })

  test("GET / returns an empty list for a directory with no pending questions", async () => {
    await using tmp = await tmpdir()
    const res = await Instance.provide({
      directory: tmp.path,
      fn: () => QuestionRoutes().request("/"),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
