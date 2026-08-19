import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigCommand } from "@/config/command"

async function withTmpdir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-command-"))
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("config.ConfigCommand.load", () => {
  test("returns an empty object when there is no command directory", async () => {
    await withTmpdir(async (dir) => {
      expect(await ConfigCommand.load(dir)).toEqual({})
    })
  })

  test("loads a command from a .md file under command/", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "command"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "command", "hello.md"),
        ["---", "description: says hello", "---", "Say hello to {{name}}"].join("\n"),
      )

      const result = await ConfigCommand.load(dir)
      expect(result["hello"]).toBeDefined()
      expect(result["hello"].description).toBe("says hello")
      expect(result["hello"].template).toBe("Say hello to {{name}}")
    })
  })

  test("also scans the plural commands/ directory", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "commands"), { recursive: true })
      await fs.writeFile(path.join(dir, "commands", "plural.md"), "Plural template")

      const result = await ConfigCommand.load(dir)
      expect(result["plural"].template).toBe("Plural template")
    })
  })

  test("loads commands nested in subdirectories, using the path as the name", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "command", "nested"), { recursive: true })
      await fs.writeFile(path.join(dir, "command", "nested", "deep.md"), "Nested template")

      const result = await ConfigCommand.load(dir)
      expect(Object.keys(result)).toContain("nested/deep")
    })
  })

  test("throws InvalidError when frontmatter doesn't match the schema", async () => {
    await withTmpdir(async (dir) => {
      await fs.mkdir(path.join(dir, "command"), { recursive: true })
      // subtask must be a boolean; this frontmatter passes a string instead.
      await fs.writeFile(
        path.join(dir, "command", "bad.md"),
        ["---", "subtask: not-a-boolean", "---", "body"].join("\n"),
      )

      await expect(ConfigCommand.load(dir)).rejects.toThrow()
    })
  })
})
