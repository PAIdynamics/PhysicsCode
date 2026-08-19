import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import Http from "node:http"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { ServerProxy } from "../../src/server/proxy"
import { Workspace } from "../../src/control-plane/workspace"
import type { WorkspaceID } from "../../src/control-plane/schema"
import { testEffect } from "../lib/effect"

function serverUrl() {
  return HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address)))
}

type TestHandler<E, R> = (
  request: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>

function listenServer<E, R>(handler: TestHandler<E, R>) {
  return Effect.gen(function* () {
    yield* HttpServer.serveEffect()(HttpServerRequest.HttpServerRequest.use(handler))
    return yield* serverUrl()
  })
}

const workspaceLayer = (isSyncing: boolean) =>
  Layer.succeed(
    Workspace.Service,
    Workspace.Service.of({
      isSyncing: () => Effect.succeed(isSyncing),
    } as any),
  )

const testServerLayer = Layer.mergeAll(
  NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }),
  NodeServices.layer,
)

const syncing = testEffect(Layer.merge(testServerLayer, workspaceLayer(true)))
const notSyncing = testEffect(Layer.merge(testServerLayer, workspaceLayer(false)))

describe("ServerProxy.httpEffect", () => {
  notSyncing.live("returns 503 when the workspace is not syncing", () =>
    Effect.gen(function* () {
      const req = new Request("http://proxy.local/anything")
      const response = yield* ServerProxy.httpEffect("http://127.0.0.1:1/unused", undefined, req, "ws_1" as WorkspaceID)

      expect(response.status).toBe(503)
      expect(yield* Effect.promise(() => response.text())).toContain("ws_1")
    }),
  )

  syncing.live("proxies through to the upstream response, stripping encoding/length headers", () =>
    Effect.gen(function* () {
      const url = yield* listenServer(
        Effect.fnUntraced(function* (req: HttpServerRequest.HttpServerRequest) {
          const body = yield* req.text
          return yield* HttpServerResponse.json(
            { path: req.url, method: req.method, body },
            {
              status: 201,
              headers: {
                "content-encoding": "identity",
                "content-length": "999",
                "x-upstream": "yes",
              },
            },
          )
        }),
      )

      const req = new Request("http://proxy.local/some/path", { method: "POST", body: "hello" })
      const response = yield* ServerProxy.httpEffect(`${url}/some/path`, undefined, req, "ws_1" as WorkspaceID)

      expect(response.status).toBe(201)
      expect(response.headers.get("x-upstream")).toBe("yes")
      expect(response.headers.get("content-encoding")).toBeNull()
      expect(response.headers.get("content-length")).toBeNull()

      const json = (yield* Effect.promise(() => response.json())) as { path: string; method: string; body: string }
      expect(json.method).toBe("POST")
      expect(json.body).toBe("hello")
    }),
  )

  syncing.live("uses an empty body for GET requests", () =>
    Effect.gen(function* () {
      const url = yield* listenServer(
        Effect.fnUntraced(function* (req: HttpServerRequest.HttpServerRequest) {
          const body = yield* req.text
          return yield* HttpServerResponse.json({ body })
        }),
      )

      const req = new Request("http://proxy.local/get-path")
      const response = yield* ServerProxy.httpEffect(url, undefined, req, "ws_1" as WorkspaceID)
      const json = (yield* Effect.promise(() => response.json())) as { body: string }
      expect(json.body).toBe("")
    }),
  )

  syncing.live("returns a 500 response instead of throwing when the upstream is unreachable", () =>
    Effect.gen(function* () {
      const req = new Request("http://proxy.local/unreachable")
      // Port 1 is a reserved/unroutable TCP port, so this connection fails
      // fast without needing a real closed-port fixture.
      const response = yield* ServerProxy.httpEffect("http://127.0.0.1:1/x", undefined, req, "ws_1" as WorkspaceID)
      expect(response.status).toBe(500)
    }),
  )
})
