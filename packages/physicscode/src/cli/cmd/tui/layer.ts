import { Layer } from "effect"
import { TuiConfig } from "./config/tui"
import { Npm } from "@physicscode-ai/core/npm"
import { Observability } from "@physicscode-ai/core/effect/observability"

export const CliLayer = Observability.layer.pipe(Layer.merge(TuiConfig.layer), Layer.provide(Npm.defaultLayer))
