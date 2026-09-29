/**
 * Mechanical science retrieval for the `science` agent.
 *
 * When the session runs on `science` (enabled with /science), every user
 * prompt is searched against the PhysicsCode Science index *before* the model
 * sees it, and the evidence is attached to the user message as a synthetic
 * text part. This makes the "every prompt goes through science indexing"
 * guarantee independent of whether the model chooses to call the tool.
 */

/** Agent whose prompts are always pre-searched. */
export const AGENT = "science"

/** MCP tools are keyed `<client>_<tool>`; the science server exposes `science_search`. */
export const SEARCH_SUFFIX = "_science_search"

export const TOP_K = 8
export const MAX_CHARS = 16_000
export const TIMEOUT = "60 seconds"

export function pickSearchTool<T>(tools: Record<string, T>): [string, T] | undefined {
  const entries = Object.entries(tools).filter(([key]) => key.endsWith(SEARCH_SUFFIX))
  // Prefer the account-provided `science` client when several are connected.
  return entries.find(([key]) => key === "science" + SEARCH_SUFFIX) ?? entries[0]
}

/** Text the model receives when the search ran. */
export function evidence(input: { tool: string; query: string; text: string }) {
  const body = input.text.length > MAX_CHARS ? input.text.slice(0, MAX_CHARS) + "\n... [truncated]" : input.text
  return [
    "Science retrieval mode is ON. The PhysicsCode Science index was searched automatically for this prompt.",
    `Tool: ${input.tool}`,
    `Query: ${input.query}`,
    "",
    "Retrieved evidence:",
    "",
    body,
    "",
    "Use this evidence where it is relevant and cite provenance exactly (repository, path, line range, license).",
    "If it is not relevant to the prompt, say so briefly. Run further science tool calls yourself when you need",
    "more or different evidence. Do not claim evidence beyond what was retrieved.",
  ].join("\n")
}

/** Text the model receives when the search could not run. */
export function unavailable(reason: string) {
  return [
    "Science retrieval mode is ON, but the automatic search of the PhysicsCode Science index did not run:",
    reason,
    "",
    "Tell the user this plainly before answering, then try the science tools yourself if they are available.",
  ].join("\n")
}

/** Reduce an MCP call result to the text it carried. */
export function text(result: unknown): string {
  if (!result || typeof result !== "object") return ""
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ""
  return content
    .filter((item): item is { type: "text"; text: string } => {
      return (
        !!item && typeof item === "object" && (item as any).type === "text" && typeof (item as any).text === "string"
      )
    })
    .map((item) => item.text)
    .join("\n")
}

export * as SessionScience from "./science"
