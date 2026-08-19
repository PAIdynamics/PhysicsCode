import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { WebSearchTool } from "@/tool/websearch"
import { Agent } from "@/agent/agent"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import type { Permission } from "@/permission"
import { SessionID, MessageID } from "@/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const sse = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: string, status = 200) =>
  HttpClientResponse.fromWeb(req, new Response(body, { status, headers: { "content-type": "text/event-stream" } }))

const sseLine = (text: string) => `data: ${JSON.stringify({ result: { content: [{ type: "text", text }] } })}\n\n`

function makeCtx() {
  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx: Tool.Context = {
    sessionID: SessionID.make("ses_test"),
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

function withClient(client: HttpClient.HttpClient) {
  return testEffect(
    Layer.mergeAll(
      Truncate.defaultLayer,
      Agent.defaultLayer,
      CrossSpawnSpawner.defaultLayer,
      Layer.succeed(HttpClient.HttpClient, client),
    ),
  )
}

describe("tool.websearch", () => {
  withClient(HttpClient.make((req) => Effect.succeed(sse(req, sseLine("results"))))).live(
    "asks for websearch permission with the query and options as metadata",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { requests, ctx } = makeCtx()
          const info = yield* WebSearchTool
          const tool = yield* info.init()

          yield* tool.execute({ query: "physicscode release notes", numResults: 3, type: "fast" }, ctx)

          expect(requests).toEqual([
            {
              permission: "websearch",
              patterns: ["physicscode release notes"],
              always: ["*"],
              metadata: {
                query: "physicscode release notes",
                numResults: 3,
                livecrawl: undefined,
                type: "fast",
                contextMaxCharacters: undefined,
              },
            },
          ])
        }),
      ),
  )

  withClient(HttpClient.make((req) => Effect.succeed(sse(req, sseLine("physicscode 2.0 shipped"))))).live(
    "returns the search result text as output with a query-scoped title",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { ctx } = makeCtx()
          const info = yield* WebSearchTool
          const tool = yield* info.init()

          const result = yield* tool.execute({ query: "physicscode news" }, ctx)

          expect(result.output).toBe("physicscode 2.0 shipped")
          expect(result.title).toBe("Web search: physicscode news")
        }),
      ),
  )

  withClient(HttpClient.make((req) => Effect.succeed(sse(req, "event: ping\n\n")))).live(
    "falls back to a friendly message when there are no results",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { ctx } = makeCtx()
          const info = yield* WebSearchTool
          const tool = yield* info.init()

          const result = yield* tool.execute({ query: "obscure query" }, ctx)

          expect(result.output).toBe("No search results found. Please try a different query.")
        }),
      ),
  )

  const seenArgs: { value?: unknown } = {}
  const defaultsClient = HttpClient.make((req) =>
    Effect.gen(function* () {
      const body = JSON.parse(new TextDecoder().decode((req.body as any).body as Uint8Array))
      seenArgs.value = body.params.arguments
      return sse(req, sseLine("ok"))
    }),
  )

  withClient(defaultsClient).live("applies defaults for type/numResults/livecrawl when not provided", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { ctx } = makeCtx()
        const info = yield* WebSearchTool
        const tool = yield* info.init()

        yield* tool.execute({ query: "defaults check" }, ctx)

        expect(seenArgs.value).toEqual({
          query: "defaults check",
          type: "auto",
          numResults: 8,
          livecrawl: "fallback",
          // Comes through the schema JSON body encoding, which represents
          // an absent optional field as `null`, not `undefined`.
          contextMaxCharacters: null,
        })
      }),
    ),
  )

  withClient(HttpClient.make(() => Effect.die("unexpected http call"))).live(
    "description interpolates the current year",
    () =>
      Effect.gen(function* () {
        const info = yield* WebSearchTool
        const tool = yield* info.init()

        expect(tool.description).toContain(new Date().getFullYear().toString())
        expect(tool.description).not.toContain("{{year}}")
      }),
  )
})
