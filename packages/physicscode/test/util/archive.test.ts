import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { Process } from "@/util/process"
import { Archive } from "@/util/archive"

// extractZip's Process.run(...) calls can't be intercepted with
// bun:test's mock.module here: archive.ts (via lsp/server.ts) is already
// pulled into test/preload.ts's eager import graph before any per-file
// mock.module call gets a chance to register, so the module's own live
// "./process" binding is already linked to the real implementation by the
// time a test file runs. Exercise the real thing instead: zip is a
// standard tool on the Linux/macOS CI images this suite runs on, so build
// a real fixture archive and extract it for real.
const unix = process.platform !== "win32" ? test : test.skip

describe("util.Archive.extractZip", () => {
  unix("extracts a real zip archive's files and directory structure", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-archive-"))
    try {
      const src = path.join(dir, "src")
      const dest = path.join(dir, "dest")
      await fs.mkdir(path.join(src, "nested"), { recursive: true })
      await fs.writeFile(path.join(src, "top.txt"), "top level")
      await fs.writeFile(path.join(src, "nested", "deep.txt"), "nested content")

      const zipPath = path.join(dir, "archive.zip")
      await Process.run(["zip", "-r", "-q", zipPath, "."], { cwd: src })

      await Archive.extractZip(zipPath, dest)

      expect(await fs.readFile(path.join(dest, "top.txt"), "utf-8")).toBe("top level")
      expect(await fs.readFile(path.join(dest, "nested", "deep.txt"), "utf-8")).toBe("nested content")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  unix("overwrites existing files in the destination (-Force / -o semantics)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-archive-"))
    try {
      const src = path.join(dir, "src")
      const dest = path.join(dir, "dest")
      await fs.mkdir(src, { recursive: true })
      await fs.mkdir(dest, { recursive: true })
      await fs.writeFile(path.join(src, "file.txt"), "new content")
      await fs.writeFile(path.join(dest, "file.txt"), "stale content")

      const zipPath = path.join(dir, "archive.zip")
      await Process.run(["zip", "-r", "-q", zipPath, "."], { cwd: src })

      await Archive.extractZip(zipPath, dest)

      expect(await fs.readFile(path.join(dest, "file.txt"), "utf-8")).toBe("new content")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
