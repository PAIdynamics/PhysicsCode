import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Patch } from "../../src/patch"
import * as fs from "fs/promises"
import * as path from "path"
import { tmpdir } from "os"

describe("Patch.maybeParseApplyPatchVerified", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "patch-verified-test-"))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test("returns NotApplyPatch for a non-patch command", async () => {
    const result = await Patch.maybeParseApplyPatchVerified(["echo", "hello"], tempDir)
    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.NotApplyPatch)
  })

  test("detects an implicit invocation (raw patch text with no apply_patch wrapper)", async () => {
    const patchText = `*** Begin Patch\n*** Add File: test.txt\n+Content\n*** End Patch`
    const result = await Patch.maybeParseApplyPatchVerified([patchText], tempDir)
    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.CorrectnessError)
    if (result.type === Patch.MaybeApplyPatchVerified.CorrectnessError) {
      expect(result.error.message).toBe("ImplicitInvocation")
    }
  })

  test("builds an add change for an Add File hunk", async () => {
    const patchText = `*** Begin Patch\n*** Add File: new.txt\n+hello world\n*** End Patch`
    const result = await Patch.maybeParseApplyPatchVerified(["apply_patch", patchText], tempDir)

    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.Body)
    if (result.type === Patch.MaybeApplyPatchVerified.Body) {
      const resolved = path.resolve(tempDir, "new.txt")
      const change = result.action.changes.get(resolved)
      expect(change?.type).toBe("add")
      expect((change as any).content).toBe("hello world")
      expect(result.action.cwd).toBe(tempDir)
      expect(result.action.patch).toBe(patchText)
    }
  })

  test("builds a delete change by reading the file's current content", async () => {
    await fs.writeFile(path.join(tempDir, "old.txt"), "goodbye world")
    const patchText = `*** Begin Patch\n*** Delete File: old.txt\n*** End Patch`
    const result = await Patch.maybeParseApplyPatchVerified(["apply_patch", patchText], tempDir)

    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.Body)
    if (result.type === Patch.MaybeApplyPatchVerified.Body) {
      const resolved = path.resolve(tempDir, "old.txt")
      const change = result.action.changes.get(resolved)
      expect(change?.type).toBe("delete")
      expect((change as any).content).toBe("goodbye world")
    }
  })

  test("returns a CorrectnessError when deleting a file that doesn't exist", async () => {
    const patchText = `*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch`
    const result = await Patch.maybeParseApplyPatchVerified(["apply_patch", patchText], tempDir)

    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.CorrectnessError)
    if (result.type === Patch.MaybeApplyPatchVerified.CorrectnessError) {
      expect(result.error.message).toContain("Failed to read file for deletion")
    }
  })

  test("builds an update change (including a move_path when the hunk renames the file)", async () => {
    await fs.writeFile(path.join(tempDir, "existing.txt"), "old line\n")
    const patchText = [
      "*** Begin Patch",
      "*** Update File: existing.txt",
      "*** Move to: renamed.txt",
      "@@",
      "-old line",
      "+new line",
      "*** End Patch",
    ].join("\n")
    const result = await Patch.maybeParseApplyPatchVerified(["apply_patch", patchText], tempDir)

    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.Body)
    if (result.type === Patch.MaybeApplyPatchVerified.Body) {
      const resolved = path.resolve(tempDir, "renamed.txt")
      const change = result.action.changes.get(resolved)
      expect(change?.type).toBe("update")
      expect((change as any).move_path).toBe(path.resolve(tempDir, "renamed.txt"))
      expect((change as any).new_content).toContain("new line")
    }
  })

  test("returns a CorrectnessError when updating a file that doesn't exist", async () => {
    const patchText = ["*** Begin Patch", "*** Update File: missing.txt", "@@", "-old", "+new", "*** End Patch"].join(
      "\n",
    )
    const result = await Patch.maybeParseApplyPatchVerified(["apply_patch", patchText], tempDir)
    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.CorrectnessError)
  })

  test("passes through a patch parse error", async () => {
    const result = await Patch.maybeParseApplyPatchVerified(["apply_patch", "not a real patch"], tempDir)
    expect(result.type).toBe(Patch.MaybeApplyPatchVerified.CorrectnessError)
  })
})
