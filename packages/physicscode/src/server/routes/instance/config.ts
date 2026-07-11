import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ModelsDev, normalizeFrontierEnabledProviders } from "@/provider/models"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import { mapValues } from "remeda"
import { Effect } from "effect"

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current PhysicsCode configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.get", c, function* () {
          const cfg = yield* Config.Service
          return yield* cfg.get()
        }),
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update PhysicsCode configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info.zod),
      async (c) =>
        jsonRequest("ConfigRoutes.update", c, function* () {
          const config = c.req.valid("json")
          const cfg = yield* Config.Service
          yield* cfg.update(config)
          return config
        }),
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ConfigProvidersResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.providers", c, function* () {
          const svc = yield* Provider.Service
          const cfg = yield* Config.Service
          const config = yield* cfg.get()
          const all = yield* Effect.promise(() => ModelsDev.get())
          const disabled = new Set(config.disabled_providers ?? [])
          const normalizedEnabled = normalizeFrontierEnabledProviders(config.enabled_providers)
          const enabled = normalizedEnabled ? new Set(normalizedEnabled) : undefined
          const filtered: Record<string, (typeof all)[string]> = {}
          for (const [key, value] of Object.entries(all)) {
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          const connected = yield* svc.list()
          const providers = Object.assign(
            mapValues(filtered, (x) => Provider.fromModelsDevProvider(x)),
            connected,
          )
          return {
            providers: Object.values(providers),
            default: Provider.defaultModelIDs(providers),
          }
        }),
    ),
)
