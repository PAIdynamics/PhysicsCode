import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { buffer } from "node:stream/consumers"
import { spawn } from "@/lsp/launch"
import { tmpdir } from "../fixture/fixture"

describe("LSP.launch.spawn", () => {
  test("spawns cmd scripts with spaces on Windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "echo cmd.cmd")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

    const proc = spawn(file, ["--stdio"])

    expect(await proc.exited).toBe(0)
  })

  test("spawns a process with piped stdin/stdout/stderr using cmd + args + opts", async () => {
    const proc = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {})
    try {
      expect(proc.stdin).toBeDefined()
      expect(proc.stdout).toBeDefined()
      expect(proc.stderr).toBeDefined()

      proc.stdin.write("hello\n")
      proc.stdin.end()
      const out = await buffer(proc.stdout)
      expect(out.toString()).toBe("hello\n")
      await proc.exited
    } finally {
      proc.kill()
    }
  })

  test("spawns a process using the cmd + opts overload (no args)", () => {
    // Only exercising the "cmd + opts, no args array" overload resolution
    // here - not waiting on the child's own behavior, since a REPL binary
    // invoked with zero args and no stdin content is otherwise unrelated
    // to what this overload is responsible for.
    const proc = spawn(process.execPath, { cwd: process.cwd() })
    try {
      expect(proc.stdin).toBeDefined()
      expect(proc.stdout).toBeDefined()
      expect(proc.stderr).toBeDefined()
    } finally {
      proc.kill()
    }
  })
})
