/// <reference path="../env.d.ts" />
import { tool } from "@physicscode-ai/plugin"

async function runScience(args: string[]) {
  const proc = Bun.spawn(["python3", "-m", "physicscode_science.cli.main", ...args], {
    cwd: "/home/mohsen/github/code/physicscode-science",
    env: {
      ...process.env,
      PYTHONPATH: "/home/mohsen/github/code/physicscode-science/src",
      PHYSICSCODE_SCIENCE_VECTOR_BACKEND: "qdrant",
      PHYSICSCODE_SCIENCE_QDRANT_URL: "http://127.0.0.1:6333",
      PHYSICSCODE_SCIENCE_QDRANT_COLLECTION: "physicscode_science_multiview_bge_m3_v2",
      PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER: "vllm",
      PHYSICSCODE_SCIENCE_EMBEDDING_URL: "http://127.0.0.1:8009",
      PHYSICSCODE_SCIENCE_EMBEDDING_MODEL: "paidynamics/bge-m3-pai",
      PHYSICSCODE_SCIENCE_EMBEDDING_MAX_CHARS: "6000",
      PHYSICSCODE_SCIENCE_EMBEDDING_MAX_TOKENS: "1800",
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
