import { Flag } from "@physicscode-ai/core/flag/flag"
import { InstallationChannel, InstallationVersion } from "@physicscode-ai/core/installation/version"

export type Backend = "effect-httpapi" | "hono"

export type Selection = {
  backend: Backend
  reason: "env" | "stable" | "explicit"
}

export type Attributes = ReturnType<typeof attributes>

export function select(): Selection {
  if (Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI) return { backend: "effect-httpapi", reason: "env" }
  return { backend: "hono", reason: "stable" }
}

export function attributes(selection: Selection): Record<string, string> {
  return {
    "physicscode.server.backend": selection.backend,
    "physicscode.server.backend.reason": selection.reason,
    "physicscode.installation.channel": InstallationChannel,
    "physicscode.installation.version": InstallationVersion,
  }
}

export function force(selection: Selection, backend: Backend): Selection {
  return {
    backend,
    reason: selection.backend === backend ? selection.reason : "explicit",
  }
}
