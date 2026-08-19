import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Instance } from "../../src/project/instance"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"

const projectRoot = path.join(import.meta.dir, "../..")

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

async function withFetch(fetch: (req: Request) => Response | Promise<Response>, fn: (url: URL) => Promise<void>) {
  using server = Bun.serve({ port: 0, fetch })
  await fn(server.url)
}

function exec(args: { url: string; format: "text" | "markdown" | "html" }) {
  return WebFetchTool.pipe(
    Effect.flatMap((info) => info.init()),
    Effect.flatMap((tool) => tool.execute(args, ctx)),
    Effect.provide(Layer.mergeAll(FetchHttpClient.layer, Truncate.defaultLayer, Agent.defaultLayer)),
    Effect.runPromise,
  )
}

describe("tool.webfetch", () => {
  test("returns image responses as file attachments", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    await withFetch(
      () => new Response(bytes, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const result = await exec({ url: new URL("/image.png", url).toString(), format: "markdown" })
            expect(result.output).toBe("Image fetched successfully")
            expect(result.attachments).toBeDefined()
            expect(result.attachments?.length).toBe(1)
            expect(result.attachments?.[0].type).toBe("file")
            expect(result.attachments?.[0].mime).toBe("image/png")
            expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
            expect(result.attachments?.[0]).not.toHaveProperty("id")
            expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
            expect(result.attachments?.[0]).not.toHaveProperty("messageID")
          },
        })
      },
    )
  })

  test("keeps svg as text output", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>'
    await withFetch(
      () =>
        new Response(svg, {
          status: 200,
          headers: { "content-type": "image/svg+xml; charset=UTF-8" },
        }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const result = await exec({ url: new URL("/image.svg", url).toString(), format: "html" })
            expect(result.output).toContain("<svg")
            expect(result.attachments).toBeUndefined()
          },
        })
      },
    )
  })

  test("keeps text responses as text output", async () => {
    await withFetch(
      () =>
        new Response("hello from webfetch", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const result = await exec({ url: new URL("/file.txt", url).toString(), format: "text" })
            expect(result.output).toBe("hello from webfetch")
            expect(result.attachments).toBeUndefined()
          },
        })
      },
    )
  })

  test("converts HTML to markdown when format=markdown", async () => {
    await withFetch(
      () =>
        new Response("<h1>Title</h1><p>Some <strong>bold</strong> text.</p>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const result = await exec({ url: new URL("/page.html", url).toString(), format: "markdown" })
            expect(result.output).toContain("# Title")
            expect(result.output).toContain("**bold**")
          },
        })
      },
    )
  })

  test("extracts plain text from HTML when format=text, skipping script/style content", async () => {
    await withFetch(
      () =>
        new Response("<html><body><style>.x{color:red}</style><script>evil()</script><p>Visible text</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const result = await exec({ url: new URL("/page.html", url).toString(), format: "text" })
            expect(result.output).toContain("Visible text")
            expect(result.output).not.toContain("evil()")
            expect(result.output).not.toContain("color:red")
          },
        })
      },
    )
  })

  test("returns raw HTML unchanged when format=html", async () => {
    const html = "<html><body><p>raw</p></body></html>"
    await withFetch(
      () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const result = await exec({ url: new URL("/page.html", url).toString(), format: "html" })
            expect(result.output).toBe(html)
          },
        })
      },
    )
  })

  test("rejects a URL that doesn't start with http:// or https://", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "ftp://example.com/file", format: "text" })).rejects.toThrow()
      },
    })
  })

  test("rejects a response over the 5MB limit", async () => {
    const big = new Uint8Array(6 * 1024 * 1024)
    await withFetch(
      () => new Response(big, { status: 200, headers: { "content-type": "text/plain" } }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            await expect(exec({ url: new URL("/big.txt", url).toString(), format: "text" })).rejects.toThrow(
              "exceeds 5MB limit",
            )
          },
        })
      },
    )
  })

  test("titles the result with the URL and content type", async () => {
    await withFetch(
      () => new Response("hi", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const target = new URL("/hi.txt", url).toString()
            const result = await exec({ url: target, format: "text" })
            expect(result.title).toBe(`${target} (text/plain; charset=utf-8)`)
          },
        })
      },
    )
  })

  test("asks for webfetch permission with the url/format/timeout as metadata", async () => {
    const requests: any[] = []
    const trackedCtx = { ...ctx, ask: (req: any) => Effect.sync(() => requests.push(req)) }
    await withFetch(
      () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      async (url) => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const target = new URL("/ask.txt", url).toString()
            await WebFetchTool.pipe(
              Effect.flatMap((info) => info.init()),
              Effect.flatMap((tool) => tool.execute({ url: target, format: "text", timeout: 5 }, trackedCtx as any)),
              Effect.provide(Layer.mergeAll(FetchHttpClient.layer, Truncate.defaultLayer, Agent.defaultLayer)),
              Effect.runPromise,
            )
          },
        })
      },
    )

    expect(requests).toEqual([
      {
        permission: "webfetch",
        patterns: [expect.any(String)],
        always: ["*"],
        metadata: { url: expect.any(String), format: "text", timeout: 5 },
      },
    ])
  })
})
