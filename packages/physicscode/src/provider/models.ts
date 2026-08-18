import { Global } from "@physicscode-ai/core/global"
import * as Log from "@physicscode-ai/core/util/log"
import path from "path"
import { Schema } from "effect"
import { Installation } from "../installation"
import { Flag } from "@physicscode-ai/core/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { Flock } from "@physicscode-ai/core/util/flock"
import { Hash } from "@physicscode-ai/core/util/hash"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

const log = Log.create({ service: "models.dev" })
const source = url()
const filepath = path.join(
  Global.Path.cache,
  source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
)
const ttl = 5 * 60 * 1000

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(Schema.Literals(["alpha", "beta", "deprecated"])),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export const PAIDYNAMICS_PROVIDER_ID = "paidynamics"
export const PAIDYNAMICS_MODEL_ID = "pai-120b"
export const PAIDYNAMICS_UPSTREAM_MODEL_ID = PAIDYNAMICS_MODEL_ID
// Must be the www host: physicscode.ai's apex 301-redirects to www, and
// POST bodies (chat completions) don't survive that redirect.
export const PAIDYNAMICS_BASE_URL = "https://www.physicscode.ai/llm/v1"

const PaidynamicsModelDefinitions = {
  [PAIDYNAMICS_MODEL_ID]: {
    upstream: PAIDYNAMICS_UPSTREAM_MODEL_ID,
    name: "pai-120b",
    family: "pai",
    release_date: "2026-07-03",
    reasoning: true,
    tool_call: true,
    context: 131072,
    output: 8192,
  },
} as const

export const PAIDYNAMICS_MODEL_ID_ALIASES: Record<string, string> = {
  "gpt-oss-120b-pai": PAIDYNAMICS_MODEL_ID,
  "openai/gpt-oss-120b": PAIDYNAMICS_MODEL_ID,
  "glm-4.5-air-pai": PAIDYNAMICS_MODEL_ID,
  "zai-org/GLM-4.5-Air-FP8": PAIDYNAMICS_MODEL_ID,
}

export const PAIDYNAMICS_MODEL_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(PaidynamicsModelDefinitions).map(([id, model]) => [id, model.upstream]),
)

const paidynamicsModel = (model: (typeof PaidynamicsModelDefinitions)[keyof typeof PaidynamicsModelDefinitions]) => ({
  id: model.upstream,
  name: model.name,
  family: model.family,
  release_date: model.release_date,
  attachment: false,
  reasoning: model.reasoning,
  temperature: true,
  tool_call: model.tool_call,
  cost: {
    input: 0,
    output: 0,
  },
  limit: {
    context: model.context,
    output: model.output,
  },
  modalities: {
    input: ["text" as const],
    output: ["text" as const],
  },
  provider: {
    npm: "@ai-sdk/openai-compatible",
    api: PAIDYNAMICS_BASE_URL,
  },
})

export const PaidynamicsProvider = {
  id: PAIDYNAMICS_PROVIDER_ID,
  name: "PAI Dynamics Hosted",
  api: PAIDYNAMICS_BASE_URL,
  npm: "@ai-sdk/openai-compatible",
  env: ["PAIDYNAMICS_API_KEY", "PHYSICSCODE_PAI_API_KEY"],
  models: Object.fromEntries(
    Object.entries(PaidynamicsModelDefinitions).map(([id, model]) => [id, paidynamicsModel(model)]),
  ),
} satisfies Provider

const curatedProvider = (
  provider: Provider | undefined,
  modelIDs: string[],
  fallback: Omit<Provider, "models"> & { models?: Record<string, Model> },
) => {
  const source = provider ?? ({ ...fallback, models: fallback.models ?? {} } satisfies Provider)
  return {
    ...source,
    ...fallback,
    models: Object.fromEntries(
      modelIDs.flatMap((id) => {
        const model = source.models[id] ?? fallback.models?.[id]
        return model ? [[id, model]] : []
      }),
    ),
  } satisfies Provider
}

// "physicscode-openai"/"physicscode-anthropic" (PHYSICSCODE_OPENAI_PROVIDER_ID
// / PHYSICSCODE_ANTHROPIC_PROVIDER_ID below) are spelled out as literals here
// rather than referencing those consts, which are declared later in this
// file - this array is evaluated at module load, before that point.
export const FRONTIER_PROVIDER_IDS = [
  "paidynamics",
  "openai",
  "anthropic",
  "physicscode-openai",
  "physicscode-anthropic",
] as const
export const normalizeFrontierEnabledProviders = (enabled?: string[]) => {
  if (!enabled) return undefined
  if (enabled.length === 1 && enabled[0] === PAIDYNAMICS_PROVIDER_ID) return [...FRONTIER_PROVIDER_IDS]
  return enabled
}
export const OPENAI_FRONTIER_MODEL_IDS = [
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const
export const ANTHROPIC_FRONTIER_MODEL_IDS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
] as const

const textModel = (input: {
  id: string
  name: string
  family: string
  release_date: string
  context: number
  output: number
  npm?: string
  reasoning?: boolean
}) =>
  ({
    id: input.id,
    name: input.name,
    family: input.family,
    release_date: input.release_date,
    attachment: true,
    reasoning: input.reasoning ?? true,
    temperature: true,
    tool_call: true,
    limit: {
      context: input.context,
      output: input.output,
    },
    modalities: {
      input: ["text" as const, "image" as const],
      output: ["text" as const],
    },
    provider: input.npm ? { npm: input.npm } : undefined,
  }) satisfies Model

const OPENAI_FRONTIER_SUFFIX_ORDER = ["", "sol", "pro", "terra", "luna", "codex-max"] as const
const OPENAI_FRONTIER_EXCLUDED_SUFFIXES = new Set(["mini", "nano", "instant", "chat", "chat-latest"])
const OPENAI_FRONTIER_ALLOWED_MODEL_IDS = new Set<string>(OPENAI_FRONTIER_MODEL_IDS)

function openAIDynamicFrontierModelIDs(provider: Provider | undefined) {
  const parsed = Object.keys(provider?.models ?? {}).flatMap((id) => {
    if (!OPENAI_FRONTIER_ALLOWED_MODEL_IDS.has(id)) return []
    const match = /^gpt-(\d+)(?:\.(\d+))?(?:-([a-z0-9-]+))?$/.exec(id)
    if (!match) return []

    const suffix = match[3] ?? ""
    if (OPENAI_FRONTIER_EXCLUDED_SUFFIXES.has(suffix)) return []

    return [
      {
        id,
        major: Number(match[1]),
        minor: Number(match[2] ?? 0),
        suffix,
      },
    ]
  })

  const latest = parsed.reduce<(typeof parsed)[number] | undefined>((current, next) => {
    if (!current) return next
    if (next.major !== current.major) return next.major > current.major ? next : current
    if (next.minor !== current.minor) return next.minor > current.minor ? next : current
    return current
  }, undefined)

  if (!latest) return [...OPENAI_FRONTIER_MODEL_IDS]

  return parsed
    .filter((item) => item.major === latest.major && item.minor === latest.minor)
    .sort((a, b) => {
      const suffixA = OPENAI_FRONTIER_SUFFIX_ORDER.indexOf(a.suffix as (typeof OPENAI_FRONTIER_SUFFIX_ORDER)[number])
      const suffixB = OPENAI_FRONTIER_SUFFIX_ORDER.indexOf(b.suffix as (typeof OPENAI_FRONTIER_SUFFIX_ORDER)[number])
      const rankA = suffixA === -1 ? OPENAI_FRONTIER_SUFFIX_ORDER.length : suffixA
      const rankB = suffixB === -1 ? OPENAI_FRONTIER_SUFFIX_ORDER.length : suffixB
      return rankA - rankB || a.id.localeCompare(b.id)
    })
    .map((item) => item.id)
}

function curatedOpenAI(provider: Provider | undefined) {
  return curatedProvider(provider, openAIDynamicFrontierModelIDs(provider), {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: {
      "gpt-5.6": textModel({
        id: "gpt-5.6",
        name: "GPT-5.6 Sol",
        family: "gpt",
        release_date: "2026-07-09",
        context: 1050000,
        output: 128000,
        npm: "@ai-sdk/openai",
      }),
      "gpt-5.6-sol": textModel({
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        family: "gpt",
        release_date: "2026-07-09",
        context: 1050000,
        output: 128000,
        npm: "@ai-sdk/openai",
      }),
      "gpt-5.6-terra": textModel({
        id: "gpt-5.6-terra",
        name: "GPT-5.6 Terra",
        family: "gpt",
        release_date: "2026-07-09",
        context: 1050000,
        output: 128000,
        npm: "@ai-sdk/openai",
      }),
      "gpt-5.6-luna": textModel({
        id: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        family: "gpt",
        release_date: "2026-07-09",
        context: 1050000,
        output: 128000,
        npm: "@ai-sdk/openai",
      }),
    },
  })
}

function curatedAnthropic(provider: Provider | undefined) {
  return curatedProvider(provider, [...ANTHROPIC_FRONTIER_MODEL_IDS], {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-fable-5": textModel({
        id: "claude-fable-5",
        name: "Claude Fable 5",
        family: "claude-fable",
        release_date: "2026-06-01",
        context: 1000000,
        output: 128000,
        npm: "@ai-sdk/anthropic",
      }),
      "claude-opus-4-8": textModel({
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        family: "claude-opus",
        release_date: "2026-05-28",
        context: 1000000,
        output: 128000,
        npm: "@ai-sdk/anthropic",
      }),
    },
  })
}

// Lets a logged-in PhysicsCode user pay for real OpenAI/Anthropic usage out
// of their PhysicsCode credit instead of bringing their own vendor key - the
// Worker at PHYSICSCODE_*_BASE_URL debits their account and forwards to the
// real API. Reuses the curated frontier model metadata (names/limits) so it
// doesn't drift from the BYOK "openai"/"anthropic" providers; only the
// provider id, auth, and upstream URL differ.
export const PHYSICSCODE_OPENAI_PROVIDER_ID = "physicscode-openai"
export const PHYSICSCODE_OPENAI_BASE_URL = "https://www.physicscode.ai/openai/v1"
export const PHYSICSCODE_ANTHROPIC_PROVIDER_ID = "physicscode-anthropic"
export const PHYSICSCODE_ANTHROPIC_BASE_URL = "https://www.physicscode.ai/anthropic"

function rebrandFrontierProvider(
  source: Provider,
  opts: { id: string; name: string; baseURL: string; npm: string },
): Provider {
  return {
    ...source,
    id: opts.id,
    name: opts.name,
    api: opts.baseURL,
    npm: opts.npm,
    env: [],
    models: Object.fromEntries(
      Object.entries(source.models).map(([modelID, model]) => [
        modelID,
        { ...model, provider: { npm: opts.npm, api: opts.baseURL } },
      ]),
    ),
  }
}

function url() {
  return Flag.PHYSICSCODE_MODELS_URL || "https://models.dev"
}

function fresh() {
  return Date.now() - Number(Filesystem.stat(filepath)?.mtimeMs ?? 0) < ttl
}

function skip(force: boolean) {
  return !force && fresh()
}

const fetchApi = async () => {
  const result = await fetch(`${url()}/api.json`, {
    headers: { "User-Agent": Installation.USER_AGENT },
    signal: AbortSignal.timeout(10000),
  })
  return { ok: result.ok, text: await result.text() }
}

export const Data = lazy(async () => {
  const result = await Filesystem.readJson(Flag.PHYSICSCODE_MODELS_PATH ?? filepath).catch(() => {})
  if (result) return result
  // @ts-ignore
  const snapshot = await import("./models-snapshot.js")
    .then((m) => m.snapshot as Record<string, unknown>)
    .catch(() => undefined)
  if (snapshot) return snapshot
  if (Flag.PHYSICSCODE_DISABLE_MODELS_FETCH) return {}
  return Flock.withLock(`models-dev:${filepath}`, async () => {
    const result = await Filesystem.readJson(Flag.PHYSICSCODE_MODELS_PATH ?? filepath).catch(() => {})
    if (result) return result
    const result2 = await fetchApi()
    if (result2.ok) {
      await Filesystem.write(filepath, result2.text).catch((e) => {
        log.error("Failed to write models cache", { error: e })
      })
    }
    return JSON.parse(result2.text)
  })
})

export async function get(): Promise<Record<string, Provider>> {
  const result = await Data()
  const providers = result as Record<string, Provider>
  const curatedOpenAIProvider = curatedOpenAI(providers.openai)
  const curatedAnthropicProvider = curatedAnthropic(providers.anthropic)
  return {
    ...providers,
    [PAIDYNAMICS_PROVIDER_ID]: PaidynamicsProvider,
    [PHYSICSCODE_OPENAI_PROVIDER_ID]: rebrandFrontierProvider(curatedOpenAIProvider, {
      id: PHYSICSCODE_OPENAI_PROVIDER_ID,
      name: "PhysicsCode Credit (OpenAI)",
      baseURL: PHYSICSCODE_OPENAI_BASE_URL,
      npm: "@ai-sdk/openai-compatible",
    }),
    [PHYSICSCODE_ANTHROPIC_PROVIDER_ID]: rebrandFrontierProvider(curatedAnthropicProvider, {
      id: PHYSICSCODE_ANTHROPIC_PROVIDER_ID,
      name: "PhysicsCode Credit (Anthropic)",
      baseURL: PHYSICSCODE_ANTHROPIC_BASE_URL,
      npm: "@ai-sdk/anthropic",
    }),
  }
}

export async function refresh(force = false) {
  if (skip(force)) return Data.reset()
  await Flock.withLock(`models-dev:${filepath}`, async () => {
    if (skip(force)) return Data.reset()
    const result = await fetchApi()
    if (!result.ok) return
    await Filesystem.write(filepath, result.text)
    Data.reset()
  }).catch((e) => {
    log.error("Failed to fetch models.dev", {
      error: e,
    })
  })
}

if (!Flag.PHYSICSCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  void refresh()
  setInterval(
    async () => {
      await refresh()
    },
    60 * 1000 * 60,
  ).unref()
}

export * as ModelsDev from "./models"
