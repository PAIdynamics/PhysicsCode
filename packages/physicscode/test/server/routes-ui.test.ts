import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import type { AppFileSystem } from "@physicscode-ai/core/filesystem"
import { serveUIEffect } from "@/server/routes/ui"

function fakeFs(): AppFileSystem.Interface {
  return {
    existsSafe: () => Effect.succeed(false),
  } as unknown as AppFileSystem.Interface
}

describe("server.routes.ui.serveUIEffect", () => {
  test("proxies to the upstream and strips content-encoding/content-length headers", async () => {
    const client = HttpClient.make(() =>
      Effect.succeed(
        HttpServerResponseAsClientResponse("plain body", {
          "content-type": "text/plain",
          "content-encoding": "gzip",
          "content-length": "999",
        }),
      ),
    )

    const request = HttpServerRequest.fromWeb(new Request("http://localhost/some/path"))
    const response = await Effect.runPromise(serveUIEffect(request, { fs: fakeFs(), client }))
    const web = HttpServerResponse.toWeb(response)

    expect(web.headers.get("content-encoding")).toBeNull()
    expect(web.headers.get("content-length")).toBeNull()
    expect(web.headers.get("content-security-policy")).toContain("default-src 'self'")
  })

  test("injects a theme-preload script hash into the CSP for HTML responses", async () => {
    const html =
      '<html><head><script id="oc-theme-preload-script">document.body.classList.add("dark")</script></head></html>'
    const client = HttpClient.make(() =>
      Effect.succeed(HttpServerResponseAsClientResponse(html, { "content-type": "text/html; charset=utf-8" })),
    )

    const request = HttpServerRequest.fromWeb(new Request("http://localhost/"))
    const response = await Effect.runPromise(serveUIEffect(request, { fs: fakeFs(), client }))
    const web = HttpServerResponse.toWeb(response)

    const csp = web.headers.get("content-security-policy")
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval' 'sha256-")
    expect(await web.text()).toBe(html)
  })

  test("does not add a script hash for HTML with no theme-preload script", async () => {
    const html = "<html><body>hello</body></html>"
    const client = HttpClient.make(() =>
      Effect.succeed(HttpServerResponseAsClientResponse(html, { "content-type": "text/html; charset=utf-8" })),
    )

    const request = HttpServerRequest.fromWeb(new Request("http://localhost/"))
    const response = await Effect.runPromise(serveUIEffect(request, { fs: fakeFs(), client }))
    const web = HttpServerResponse.toWeb(response)

    const csp = web.headers.get("content-security-policy")
    expect(csp).not.toContain("sha256-")
  })

  test("streams non-HTML responses through without buffering them into text", async () => {
    const client = HttpClient.make(() =>
      Effect.succeed(HttpServerResponseAsClientResponse('{"ok":true}', { "content-type": "application/json" })),
    )

    const request = HttpServerRequest.fromWeb(new Request("http://localhost/api/data"))
    const response = await Effect.runPromise(serveUIEffect(request, { fs: fakeFs(), client }))
    const web = HttpServerResponse.toWeb(response)

    expect(await web.text()).toBe('{"ok":true}')
    expect(web.headers.get("content-security-policy")).toContain("default-src 'self'")
  })
})

// Builds a value shaped like what HttpClient.execute resolves to (an
// HttpClientResponse) from a plain web Response.
function HttpServerResponseAsClientResponse(body: string, headers: Record<string, string>) {
  const webResponse = new Response(body, { status: 200, headers })
  return HttpClientResponse.fromWeb(HttpClientRequest.get("http://upstream.example/"), webResponse)
}
