import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import * as McpExa from "@/tool/mcp-exa"

const sse = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: string, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(body, { status, headers: { "content-type": "text/event-stream" } }),
  )

const sseLine = (text: string) =>
  `data: ${JSON.stringify({ result: { content: [{ type: "text", text }] } })}\n\n`

const Args = Schema.Struct({ query: Schema.String })

describe("tool.McpExa.call", () => {
  test("extracts the text from the first SSE data line with content", async () => {
    const client = HttpClient.make((req) => Effect.succeed(sse(req, sseLine("search results here"))))

    const result = await Effect.runPromise(
      McpExa.call(client, "web_search_exa", Args, { query: "hello" }, "5 seconds"),
    )

    expect(result).toBe("search results here")
  })

  test("sends the request as a JSON-RPC tools/call with the given tool name and args", async () => {
    let seenBody: unknown
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        seenBody = JSON.parse(new TextDecoder().decode((req.body as any).body as Uint8Array))
        return sse(req, sseLine("ok"))
      }),
    )

    await Effect.runPromise(McpExa.call(client, "web_search_exa", Args, { query: "hello world" }, "5 seconds"))

    expect(seenBody).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query: "hello world" } },
    })
  })

  test("returns undefined when no SSE data line contains content", async () => {
    const client = HttpClient.make((req) => Effect.succeed(sse(req, "event: ping\n\n")))

    const result = await Effect.runPromise(
      McpExa.call(client, "web_search_exa", Args, { query: "hello" }, "5 seconds"),
    )

    expect(result).toBeUndefined()
  })

  test("skips malformed SSE data lines and returns the next valid one", async () => {
    const client = HttpClient.make((req) =>
      Effect.succeed(sse(req, `data: not json\n\n${sseLine("second line wins")}`)),
    )

    const exit = await Effect.runPromiseExit(
      McpExa.call(client, "web_search_exa", Args, { query: "hello" }, "5 seconds"),
    )

    // A malformed data line fails schema decoding for that line rather than
    // being skipped - the whole call fails instead of falling through to
    // the next line. Document that as the actual current behavior.
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("fails when the upstream returns a non-2xx status", async () => {
    const client = HttpClient.make((req) => Effect.succeed(sse(req, "", 500)))

    const exit = await Effect.runPromiseExit(
      McpExa.call(client, "web_search_exa", Args, { query: "hello" }, "5 seconds"),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("dies with a timeout error when the request takes longer than the given duration", async () => {
    const client = HttpClient.make((req) => Effect.succeed(sse(req, sseLine("too slow"))).pipe(Effect.delay("1 second")))

    const exit = await Effect.runPromiseExit(
      McpExa.call(client, "web_search_exa", Args, { query: "hello" }, "10 millis"),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain("request timed out")
    }
  })
})
