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
export const PAIDYNAMICS_MODEL_ID = "gpt-oss-120b-pai"
export const PAIDYNAMICS_UPSTREAM_MODEL_ID = "openai/gpt-oss-120b"
export const PAIDYNAMICS_BASE_URL = "https://www.paidynamics.ch/llm/v1"

const PaidynamicsModelDefinitions = {
  [PAIDYNAMICS_MODEL_ID]: {
    upstream: PAIDYNAMICS_UPSTREAM_MODEL_ID,
    name: "gpt-oss-120b-pai",
    family: "gpt-oss",
    release_date: "2026-07-03",
    reasoning: true,
    tool_call: true,
    context: 131072,
    output: 8192,
  },
  "deepseek-r1-distill-qwen-32b-pai": {
    upstream: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    name: "deepseek-r1-distill-qwen-32b-pai",
    family: "deepseek-r1",
    release_date: "2025-01-20",
    reasoning: true,
    tool_call: false,
    context: 32768,
    output: 8192,
  },
  "glm-4.5-air-pai": {
    upstream: "zai-org/GLM-4.5-Air-FP8",
    name: "glm-4.5-air-pai",
    family: "glm45",
    release_date: "2025-07-20",
    reasoning: true,
    tool_call: true,
    context: 4096,
    output: 2048,
  },
  "gpt-oss-20b-pai": {
    upstream: "openai/gpt-oss-20b",
    name: "gpt-oss-20b-pai",
    family: "gpt-oss",
    release_date: "2026-07-03",
    reasoning: true,
    tool_call: true,
    context: 131072,
    output: 8192,
  },
  "qwen3-8b-pai": {
    upstream: "Qwen/Qwen3-8B",
    name: "qwen3-8b-pai",
    family: "qwen3",
    release_date: "2025-05-14",
    reasoning: true,
    tool_call: true,
    context: 32768,
    output: 8192,
  },
} as const

export const PAIDYNAMICS_MODEL_ID_ALIASES: Record<string, string> = {
  "deepseek-r1-distil-qwen-32b-pai": "deepseek-r1-distill-qwen-32b-pai",
  "paidynamics/deepseek-r1-distil-qwen-32b-pai": "deepseek-r1-distill-qwen-32b-pai",
}

export const PAIDYNAMICS_MODEL_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(PaidynamicsModelDefinitions)
    .map(([id, model]) => [id, model.upstream])
    .concat([
      ["deepseek-r1-distil-qwen-32b-pai", "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"],
      ["paidynamics/deepseek-r1-distil-qwen-32b-pai", "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"],
      ["zai-org/GLM-4.5-Air", "zai-org/GLM-4.5-Air-FP8"],
    ]),
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

export const FRONTIER_PROVIDER_IDS = ["paidynamics", "openai", "anthropic"] as const
export const normalizeFrontierEnabledProviders = (enabled?: string[]) => {
  if (!enabled) return undefined
  if (enabled.length === 1 && enabled[0] === PAIDYNAMICS_PROVIDER_ID) return [...FRONTIER_PROVIDER_IDS]
  return enabled
}
export const OPENAI_FRONTIER_MODEL_IDS = [
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4-pro",
  "gpt-5.2-pro",
  "gpt-5.1-codex-max",
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

function curatedOpenAI(provider: Provider | undefined) {
  return curatedProvider(provider, [...OPENAI_FRONTIER_MODEL_IDS], {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: {
      "gpt-5.5": textModel({
        id: "gpt-5.5",
        name: "GPT-5.5",
        family: "gpt",
        release_date: "2026-04-23",
        context: 400000,
        output: 128000,
        npm: "@ai-sdk/openai",
      }),
      "gpt-5.5-pro": textModel({
        id: "gpt-5.5-pro",
        name: "GPT-5.5 Pro",
        family: "gpt-pro",
        release_date: "2026-04-23",
        context: 400000,
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
  return {
    ...providers,
    [PAIDYNAMICS_PROVIDER_ID]: PaidynamicsProvider,
    openai: curatedOpenAI(providers.openai),
    anthropic: curatedAnthropic(providers.anthropic),
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
