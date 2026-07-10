/// <reference path="../env.d.ts" />
import { tool } from "@physicscode-ai/plugin"

async function runMcpTool(name: string, args: Record<string, unknown>) {
  const script = `
import json
import os
from physicscode_science.mcp.tools import call_tool
print(json.dumps(call_tool("/home/mohsen/github/code/physicscode-science/.science/physicscode-science.sqlite", os.environ["SCIENCE_TOOL_NAME"], json.loads(os.environ["SCIENCE_TOOL_ARGS"])), indent=2, sort_keys=True))
`
  const proc = Bun.spawn(["python3", "-c", script], {
    cwd: "/home/mohsen/github/code/physicscode-science",
    env: {
      ...process.env,
      PYTHONPATH: "/home/mohsen/github/code/physicscode-science/src",
      SCIENCE_TOOL_NAME: name,
      SCIENCE_TOOL_ARGS: JSON.stringify(args),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || `physicscode-science exited with ${exitCode}`)
  return stdout
}

export default tool({
  description: `Fetch an exact PhysicsCode Science source object by result_id/object_id.

Use this after science-search when raw source and full provenance are needed.`,
  args: {
    object_id: tool.schema.string().describe("The result_id/object_id returned by science-search"),
  },
  async execute(args) {
    return await runMcpTool("science_get_source", { object_id: args.object_id })
  },
})
