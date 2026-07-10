/// <reference path="../env.d.ts" />
import { tool } from "@physicscode-ai/plugin"

async function runScience(args: string[]) {
  const proc = Bun.spawn(["python3", "-m", "physicscode_science.cli.main", ...args], {
    cwd: "/home/mohsen/github/code/physicscode-science",
    env: {
      ...process.env,
      PYTHONPATH: "/home/mohsen/github/code/physicscode-science/src",
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
  description: `Search the local PhysicsCode Science retrieval index.

Returns source-backed scientific software results with repository, commit, path,
line range, symbol, language, license, score, retrieval channels, and summary.
Use this before implementing scientific algorithms or adapting external code.`,
  args: {
    query: tool.schema.string().describe("Scientific or implementation query"),
    top_k: tool.schema.number().describe("Maximum number of results").default(10),
    repository: tool.schema.string().describe("Optional repository filter").optional(),
    domain: tool.schema.string().describe("Optional scientific domain filter").optional(),
    language: tool.schema.string().describe("Optional language filter such as cpp, c, python, fortran").optional(),
    license: tool.schema.string().describe("Optional SPDX-style license filter").optional(),
    include_content: tool.schema.boolean().describe("Include raw source content in results").default(false),
  },
  async execute(args) {
    const cliArgs = [
      "search",
      args.query,
      "--db",
      "/home/mohsen/github/code/physicscode-science/.science/physicscode-science.sqlite",
      "--top-k",
      String(args.top_k),
    ]
    if (args.repository) cliArgs.push("--repository", args.repository)
    if (args.domain) cliArgs.push("--domain", args.domain)
    if (args.language) cliArgs.push("--language", args.language)
    if (args.license) cliArgs.push("--license", args.license)
    if (args.include_content) cliArgs.push("--include-content")
    return await runScience(cliArgs)
  },
})
