import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigAgent } from "@/config/agent"

async function withTmpdir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-agent-"))
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("config.ConfigAgent.load", () => {
  test("returns an empty object when there is no agent directory", async () => {
    await withTmpdir(async (dir) => {
      expect(await ConfigAgent.load(dir)).toEqual({})
    })
  })

  test("loads an agent from a .md file under agent/", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "agent"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "agent", "reviewer.md"),
        ["---", "description: reviews code", "mode: subagent", "---", "You review code carefully."].join("\n"),
      )

      const result = await ConfigAgent.load(dir)
      expect(result["reviewer"]).toBeDefined()
      expect(result["reviewer"].description).toBe("reviews code")
      expect(result["reviewer"].mode).toBe("subagent")
      expect(result["reviewer"].prompt).toBe("You review code carefully.")
    })
  })

  test("also scans the plural agents/ directory", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "agents"), { recursive: true })
      await fs.writeFile(path.join(dir, "agents", "plural.md"), "Plural agent prompt")

      const result = await ConfigAgent.load(dir)
      expect(result["plural"].prompt).toBe("Plural agent prompt")
    })
  })

  test("promotes deprecated tools map into the permission field", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "agent"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "agent", "legacy.md"),
        ["---", "tools:", "  edit: false", "  bash: true", "---", "legacy prompt"].join("\n"),
      )

      const result = await ConfigAgent.load(dir)
      expect(result["legacy"].permission?.edit).toBe("deny")
      expect(result["legacy"].permission?.bash).toBe("allow")
    })
  })

  test("coalesces the deprecated maxSteps alias into steps", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "agent"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "agent", "capped.md"),
        ["---", "maxSteps: 5", "---", "capped prompt"].join("\n"),
      )

      const result = await ConfigAgent.load(dir)
      expect(result["capped"].steps).toBe(5)
    })
  })

  test("promotes unknown frontmatter keys into options", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "agent"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "agent", "custom.md"),
        ["---", "customField: hello", "---", "custom prompt"].join("\n"),
      )

      const result = await ConfigAgent.load(dir)
      expect(result["custom"].options?.["customField"]).toBe("hello")
    })
  })
})

describe("config.ConfigAgent.loadMode", () => {
  test("returns an empty object when there is no mode directory", async () => {
    await withTmpdir(async (dir) => {
      expect(await ConfigAgent.loadMode(dir)).toEqual({})
    })
  })

  test("loads a mode and forces mode to 'primary'", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "mode"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "mode", "build.md"),
        ["---", "description: build mode", "---", "build mode prompt"].join("\n"),
      )

      const result = await ConfigAgent.loadMode(dir)
      expect(result["build"].mode).toBe("primary")
      expect(result["build"].description).toBe("build mode")
    })
  })

  test("silently skips a mode file that fails schema validation", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "mode"), { recursive: true })
      // temperature must be a number.
      await fs.writeFile(
        path.join(dir, "mode", "broken.md"),
        ["---", "temperature: not-a-number", "---", "broken prompt"].join("\n"),
      )

      const result = await ConfigAgent.loadMode(dir)
      expect(result["broken"]).toBeUndefined()
    })
  })
})
