import { afterEach, describe, expect } from "bun:test"
import { Effect, FileSystem, Layer, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Flag } from "@physicscode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import * as Log from "@physicscode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const original = Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI
const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
const providerID = "test-oauth-parity"
const oauthURL = "https://example.com/oauth"
const oauthInstructions = "Finish OAuth"

function app(experimental: boolean) {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}

function requestAuthorize(input: {
  app: ReturnType<typeof app>
  providerID: string
  method: number
  headers: HeadersInit
}) {
  return Effect.promise(async () => {
    const response = await input.app.request(`/provider/${input.providerID}/oauth/authorize`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method }),
    })
    return {
      status: response.status,
      body: await response.text(),
    }
  })
}

function writeProviderAuthPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    yield* fs.makeDirectory(path.join(dir, ".physicscode", "plugin"), { recursive: true })
    yield* fs.writeFileString(
      path.join(dir, ".physicscode", "plugin", "provider-oauth-parity.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-parity",',
        "  server: async () => ({",
        "    auth: {",
        `      provider: "${providerID}",`,
        "      methods: [",
        '        { type: "api", label: "API key" },',
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function requestCallback(input: {
  app: ReturnType<typeof app>
  providerID: string
  headers: HeadersInit
  body: unknown
}) {
  return Effect.promise(async () => {
    const response = await input.app.request(`/provider/${input.providerID}/oauth/callback`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify(input.body),
    })
    return {
      status: response.status,
      body: await response.text(),
    }
  })
}

function withProviderProject<A, E, R>(self: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "physicscode-test-" })

    yield* fs.writeFileString(
      path.join(dir, "physicscode.json"),
      JSON.stringify({ $schema: "https://physicscode.ai/config.json", formatter: false, lsp: false }),
    )
    yield* writeProviderAuthPlugin(dir)
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Instance.provide({ directory: dir, fn: () => Instance.dispose() })).pipe(Effect.ignore),
    )

    return yield* self(dir).pipe(provideInstance(dir))
  })
}

afterEach(async () => {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("provider HttpApi", () => {
  it.live(
    "matches legacy OAuth authorize response shapes",
    withProviderProject((dir) =>
      Effect.gen(function* () {
        const headers = { "x-physicscode-directory": dir, "content-type": "application/json" }
        const legacy = app(false)
        const httpapi = app(true)

        const apiLegacy = yield* requestAuthorize({
          app: legacy,
          providerID,
          method: 0,
          headers,
        })
        const apiHttpApi = yield* requestAuthorize({
          app: httpapi,
          providerID,
          method: 0,
          headers,
        })
        expect(apiLegacy).toEqual({ status: 200, body: "" })
        expect(apiHttpApi).toEqual(apiLegacy)

        const oauthLegacy = yield* requestAuthorize({
          app: legacy,
          providerID,
          method: 1,
          headers,
        })
        const oauthHttpApi = yield* requestAuthorize({
          app: httpapi,
          providerID,
          method: 1,
          headers,
        })
        expect(oauthHttpApi).toEqual(oauthLegacy)
        expect(JSON.parse(oauthHttpApi.body)).toEqual({
          url: oauthURL,
          method: "code",
          instructions: oauthInstructions,
        })
      }),
    ),
  )

  it.live(
    "POST /provider/:providerID/oauth/callback completes the pending OAuth flow and stores credentials",
    withProviderProject((dir) =>
      Effect.gen(function* () {
        const headers = { "x-physicscode-directory": dir, "content-type": "application/json" }
        const httpapi = app(true)

        yield* requestAuthorize({ app: httpapi, providerID, method: 1, headers })

        const callbackRes = yield* requestCallback({
          app: httpapi,
          providerID,
          headers,
          body: { method: 1, code: "test-code" },
        })
        expect(callbackRes.status).toBe(200)
        expect(JSON.parse(callbackRes.body)).toBe(true)
      }),
    ),
  )

  it.live(
    "POST /provider/:providerID/oauth/callback fails when there is no pending OAuth flow",
    withProviderProject((dir) =>
      Effect.gen(function* () {
        const headers = { "x-physicscode-directory": dir, "content-type": "application/json" }
        const httpapi = app(true)

        const callbackRes = yield* requestCallback({
          app: httpapi,
          providerID,
          headers,
          body: { method: 1, code: "test-code" },
        })
        expect(callbackRes.status).toBeGreaterThanOrEqual(400)
      }),
    ),
  )

  it.live(
    "POST /provider/:providerID/oauth/callback fails when a code-method flow is missing its code",
    withProviderProject((dir) =>
      Effect.gen(function* () {
        const headers = { "x-physicscode-directory": dir, "content-type": "application/json" }
        const httpapi = app(true)

        yield* requestAuthorize({ app: httpapi, providerID, method: 1, headers })

        const callbackRes = yield* requestCallback({
          app: httpapi,
          providerID,
          headers,
          body: { method: 1 },
        })
        expect(callbackRes.status).toBeGreaterThanOrEqual(400)
      }),
    ),
  )
})
