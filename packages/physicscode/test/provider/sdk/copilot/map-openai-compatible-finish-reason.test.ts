import { describe, expect, test } from "bun:test"
import { mapOpenAICompatibleFinishReason } from "@/provider/sdk/copilot/chat/map-openai-compatible-finish-reason"

describe("provider.copilot.mapOpenAICompatibleFinishReason", () => {
  test("maps stop", () => {
    expect(mapOpenAICompatibleFinishReason("stop")).toBe("stop")
  })

  test("maps length", () => {
    expect(mapOpenAICompatibleFinishReason("length")).toBe("length")
  })

  test("maps content_filter to content-filter", () => {
    expect(mapOpenAICompatibleFinishReason("content_filter")).toBe("content-filter")
  })

  test("maps function_call to tool-calls", () => {
    expect(mapOpenAICompatibleFinishReason("function_call")).toBe("tool-calls")
  })

  test("maps tool_calls to tool-calls", () => {
    expect(mapOpenAICompatibleFinishReason("tool_calls")).toBe("tool-calls")
  })

  test("maps unknown, null, and undefined to other", () => {
    expect(mapOpenAICompatibleFinishReason("something_else")).toBe("other")
    expect(mapOpenAICompatibleFinishReason(null)).toBe("other")
    expect(mapOpenAICompatibleFinishReason(undefined)).toBe("other")
  })
})
