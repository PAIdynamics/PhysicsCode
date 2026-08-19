import { describe, expect, test } from "bun:test"
import { UnsupportedFunctionalityError } from "@ai-sdk/provider"
import { prepareTools } from "@/provider/sdk/copilot/chat/openai-compatible-prepare-tools"

const fnTool = (name: string, description?: string) => ({
  type: "function" as const,
  name,
  description,
  inputSchema: { type: "object" as const, properties: {} },
})

describe("provider.copilot.prepareTools", () => {
  test("returns undefined tools/toolChoice for an empty tools array", () => {
    expect(prepareTools({ tools: [] })).toEqual({ tools: undefined, toolChoice: undefined, toolWarnings: [] })
  })

  test("returns undefined tools/toolChoice when tools is null", () => {
    expect(prepareTools({ tools: undefined })).toEqual({ tools: undefined, toolChoice: undefined, toolWarnings: [] })
  })

  test("converts function tools to the OpenAI-compatible shape", () => {
    const result = prepareTools({ tools: [fnTool("read", "reads a file")] })

    expect(result.tools).toEqual([
      { type: "function", function: { name: "read", description: "reads a file", parameters: { type: "object", properties: {} } } },
    ])
    expect(result.toolChoice).toBeUndefined()
    expect(result.toolWarnings).toEqual([])
  })

  test("emits an unsupported warning for provider-defined tools and drops them from the list", () => {
    const providerTool = { type: "provider" as const, id: "provider.tool" as any, name: "provider-tool", args: {} }
    const result = prepareTools({ tools: [fnTool("read"), providerTool as any] })

    expect(result.tools).toEqual([
      { type: "function", function: { name: "read", description: undefined, parameters: { type: "object", properties: {} } } },
    ])
    expect(result.toolWarnings).toEqual([{ type: "unsupported", feature: "tool type: provider" }])
  })

  test("passes through auto/none/required tool choice unchanged", () => {
    for (const type of ["auto", "none", "required"] as const) {
      const result = prepareTools({ tools: [fnTool("read")], toolChoice: { type } })
      expect(result.toolChoice).toBe(type)
    }
  })

  test("maps a specific tool choice to the function-name shape", () => {
    const result = prepareTools({
      tools: [fnTool("read")],
      toolChoice: { type: "tool", toolName: "read" },
    })

    expect(result.toolChoice).toEqual({ type: "function", function: { name: "read" } })
  })

  test("throws UnsupportedFunctionalityError for an unrecognized tool choice type", () => {
    expect(() =>
      prepareTools({
        tools: [fnTool("read")],
        toolChoice: { type: "weird" } as any,
      }),
    ).toThrow(UnsupportedFunctionalityError)
  })
})
