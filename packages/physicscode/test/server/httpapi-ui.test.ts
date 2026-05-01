import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@physicscode-ai/core/flag/flag"
import * as Log from "@physicscode-ai/core/util/log"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { AppFileSystem } from "@physicscode-ai/core/filesystem"
import {
  ServerAuthConfig,
  authorizationRouterMiddleware,
} from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { serveUIEffect } from "../../src/server/routes/ui"
import { Server } from "../../src/server/server"

void Log.init({ print: false })

const original = {
  PHYSICSCODE_EXPERIMENTAL_HTTPAPI: Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI,
  PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI: Flag.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI,
  PHYSICSCODE_SERVER_PASSWORD: Flag.PHYSICSCODE_SERVER_PASSWORD,
  PHYSICSCODE_SERVER_USERNAME: Flag.PHYSICSCODE_SERVER_USERNAME,
  envPassword: process.env.PHYSICSCODE_SERVER_PASSWORD,
  envUsername: process.env.PHYSICSCODE_SERVER_USERNAME,
}

afterEach(() => {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = original.PHYSICSCODE_EXPERIMENTAL_HTTPAPI
  Flag.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI = original.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI
  Flag.PHYSICSCODE_SERVER_PASSWORD = original.PHYSICSCODE_SERVER_PASSWORD
  Flag.PHYSICSCODE_SERVER_USERNAME = original.PHYSICSCODE_SERVER_USERNAME
  restoreEnv("PHYSICSCODE_SERVER_PASSWORD", original.envPassword)
  restoreEnv("PHYSICSCODE_SERVER_USERNAME", original.envUsername)
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function app(input?: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            PHYSICSCODE_SERVER_PASSWORD: input?.password,
            PHYSICSCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        ExperimentalHttpApiServer.context,
      )
    },
  }
}

function uiApp(input?: { password?: string; username?: string; client?: Layer.Layer<HttpClient.HttpClient> }) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        yield* router.add("*", "/*", (request) => serveUIEffect(request, { fs, client }))
      }),
    ).pipe(
      Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuthConfig.defaultLayer))),
      Layer.provide([
        AppFileSystem.defaultLayer,
        input?.client ?? httpClient(new Response("ui")),
        HttpServer.layerServices,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            PHYSICSCODE_SERVER_PASSWORD: input?.password,
            PHYSICSCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ]),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        ExperimentalHttpApiServer.context,
      )
    },
  }
}

function httpClient(response: Response, onRequest?: (request: HttpClientRequest.HttpClientRequest) => void) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      onRequest?.(request)
      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )
}

describe("HttpApi UI fallback", () => {
  test("serves the web UI through the experimental backend", async () => {
    Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI = true
    let proxiedUrl: string | undefined

    const response = await uiApp({
      client: httpClient(
        new Response("<html>physicscode</html>", { headers: { "content-type": "text/html" } }),
        (request) => {
          proxiedUrl = request.url
        },
      ),
    }).request("/")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toBe("<html>physicscode</html>")
    expect(proxiedUrl).toBe("https://app.physicscode.ai/")
  })

  test("strips upstream transfer encoding headers from proxied assets", async () => {
    Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI = true
    let proxiedUrl: string | undefined

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/assets/app.js")), {
          fs,
          client,
        })
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            AppFileSystem.defaultLayer,
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) => {
                proxiedUrl = request.url
                return Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    new Response("console.log('ok')", {
                      headers: {
                        "content-encoding": "br",
                        "content-length": "999",
                        "content-type": "text/javascript",
                      },
                    }),
                  ),
                )
              }),
            ),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      ),
    )

    expect(response.status).toBe(200)
    expect(proxiedUrl).toBe("https://app.physicscode.ai/assets/app.js")
    expect(response.headers.get("content-encoding")).toBeNull()
    expect(response.headers.get("content-length")).not.toBe("999")
    expect(response.headers.get("content-type")).toContain("text/javascript")
    expect(await response.text()).toBe("console.log('ok')")
  })

  test("keeps matched API routes ahead of the UI fallback", async () => {
    Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true

    const response = await Server.Default().app.request("/session/nope")

    expect(response.status).toBe(404)
  })

  test("requires server password for the web UI", async () => {
    Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI = true

    const response = await uiApp({ password: "secret", username: "physicscode" }).request("/")

    expect(response.status).toBe(401)
  })

  test("accepts auth token for the web UI", async () => {
    Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI = true

    const response = await uiApp({
      password: "secret",
      username: "physicscode",
      client: httpClient(new Response("<html>physicscode</html>", { headers: { "content-type": "text/html" } })),
    }).request(`/?auth_token=${btoa("physicscode:secret")}`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("<html>physicscode</html>")
  })

  test("accepts basic auth for the web UI", async () => {
    Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.PHYSICSCODE_DISABLE_EMBEDDED_WEB_UI = true

    const response = await uiApp({ password: "secret", username: "physicscode" }).request("/", {
      headers: { authorization: `Basic ${btoa("physicscode:secret")}` },
    })

    expect(response.status).toBe(200)
  })

  test("allows web UI preflight without auth", async () => {
    Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true

    const response = await app({ password: "secret", username: "physicscode" }).request("/", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  })
})
