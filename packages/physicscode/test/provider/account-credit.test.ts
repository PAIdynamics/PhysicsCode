import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { AppFileSystem } from "@physicscode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@physicscode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ModelsDev } from "@/provider/models"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Env } from "../../src/env"
import { Config } from "../../src/config/config"
import { Auth } from "../../src/auth"
import { Plugin } from "../../src/plugin/index"
import { Account } from "../../src/account/account"
import { AccessToken, AccountID, OrgID } from "../../src/account/schema"

// The PhysicsCode-credit OpenAI/Anthropic providers authenticate with the
// logged-in PhysicsCode account. These tests fake that login and check the
// providers are selectable, never become the default, and send the current
// account token as a Bearer header (the only form the physicscode.ai proxy
// accepts) on every request.

const OPENAI = ProviderID.make(ModelsDev.PHYSICSCODE_OPENAI_PROVIDER_ID)
const ANTHROPIC = ProviderID.make(ModelsDev.PHYSICSCODE_ANTHROPIC_PROVIDER_ID)

const login = { token: Option.none<string>() }
const account = {
  id: AccountID.make("account-1"),
  email: "user@example.com",
  url: "https://www.physicscode.ai",
  active_org_id: OrgID.make("org-1"),
}

const it = testEffect(
  // Suspended: Provider.layer isn't initialised yet at import time (module cycle).
  Layer.suspend(() =>
    Layer.mergeAll(
      CrossSpawnSpawner.defaultLayer,
      Provider.layer.pipe(
        Layer.provide(AppFileSystem.defaultLayer),
        Layer.provide(Env.defaultLayer),
        Layer.provide(Config.defaultLayer),
        Layer.provide(
          Layer.mock(Auth.Service)({ all: () => Effect.succeed({}), get: () => Effect.succeed(undefined) }),
        ),
        Layer.provide(
          Layer.mock(Account.Service)({
            active: () => Effect.sync(() => Option.map(login.token, () => account)),
            activeOrg: () => Effect.succeed(Option.none()),
            config: () => Effect.succeed(Option.none()),
            token: () => Effect.sync(() => Option.map(login.token, AccessToken.make)),
          }),
        ),
        Layer.provide(Plugin.defaultLayer),
      ),
    ),
  ),
)

const seen: { path: string; authorization: string | null }[] = []
const server = { port: 0, stop: () => {} }
beforeAll(() => {
  const s = Bun.serve({
    port: 0,
    fetch(request) {
      seen.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
      return Response.json({ error: { message: "stub", type: "authentication_error" } }, { status: 401 })
    },
  })
  server.port = s.port ?? 0
  server.stop = () => s.stop(true)
})
afterAll(() => server.stop())
const stub = (baseURL: string) => `http://127.0.0.1:${server.port}${new URL(baseURL).pathname}`

test("credit providers count as credentialed only with an account login", () => {
  const base = { providers: { [OPENAI]: {}, [ANTHROPIC]: {} }, config: {}, auths: {}, envs: {} }
  expect(Provider.credentialedProviderIDs({ ...base, accountToken: "t" })).toEqual([OPENAI, ANTHROPIC])
  expect(Provider.credentialedProviderIDs(base)).toEqual([])
  expect(Provider.isAccountCreditProvider(OPENAI)).toBe(true)
  expect(Provider.isAccountCreditProvider(ANTHROPIC)).toBe(true)
  expect(Provider.isAccountCreditProvider(ModelsDev.PAIDYNAMICS_PROVIDER_ID)).toBe(false)
})

describe("PhysicsCode credit providers", () => {
  it.live("are available when logged in, but never chosen as the default", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        login.token = Option.some("token-at-startup")
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        expect(Object.keys(providers[OPENAI]?.models ?? {})).toContain("gpt-5.6")
        expect(Object.keys(providers[ANTHROPIC]?.models ?? {}).length).toBeGreaterThan(0)
        const chosen = yield* provider.defaultModel()
        expect(Provider.isAccountCreditProvider(chosen.providerID)).toBe(false)
      }),
    ),
  )

  it.live("are hidden when logged out", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        login.token = Option.none()
        const providers = yield* (yield* Provider.Service).list()
        expect(providers[OPENAI]).toBeUndefined()
        expect(providers[ANTHROPIC]).toBeUndefined()
      }),
    ),
  )

  // The stub keeps the real base URLs' paths, so this also checks the
  // requests land on the routes the physicscode.ai Worker serves.
  it.live("send the current account token as a Bearer header to the proxy routes", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          login.token = Option.some("token-at-startup")
          const provider = yield* Provider.Service
          for (const [providerID, modelID, route] of [
            [OPENAI, "gpt-5.6", "/openai/v1/chat/completions"],
            [ANTHROPIC, "claude-sonnet-4-6", "/anthropic/v1/messages"],
          ] as const) {
            seen.length = 0
            // A refreshed token must be used, not the one from startup.
            login.token = Option.some(`fresh-${providerID}`)
            const language = yield* provider.getLanguage(yield* provider.getModel(providerID, ModelID.make(modelID)))
            // The stub server always answers 401; only the request matters.
            yield* Effect.promise(() =>
              Promise.resolve(
                language.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "ping" }] }] }),
              ).catch(() => undefined),
            )
            expect(seen.length).toBeGreaterThan(0)
            expect(seen[0]).toEqual({ path: route, authorization: `Bearer fresh-${providerID}` })
          }
        }),
      {
        config: {
          provider: {
            [OPENAI]: { options: { baseURL: stub(ModelsDev.PHYSICSCODE_OPENAI_BASE_URL) } },
            [ANTHROPIC]: { options: { baseURL: stub(ModelsDev.PHYSICSCODE_ANTHROPIC_BASE_URL) } },
          },
        },
      },
    ),
  )
})
