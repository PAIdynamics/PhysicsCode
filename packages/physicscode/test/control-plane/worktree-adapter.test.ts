import { describe, expect, test } from "bun:test"
import { WorktreeAdapter } from "@/control-plane/adapters/worktree"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// mock.module can't reach the "@/worktree" module this adapter dynamically
// imports: it's already pulled in transitively via @/effect/app-runtime's
// own static import, which test/preload.ts's eager initProjectors chain
// loads before any test file's mock.module call can register (same class
// of issue as archive.ts's "./process" import - see test/util/archive.test.ts).
// So this exercises the real Worktree.Service against a real git repo.

const baseInfo = {
  id: "ws_1",
  type: "worktree",
  name: "placeholder",
  branch: null,
  directory: null,
  extra: null,
  projectID: "proj_1",
} as any

describe("control-plane.adapters.WorktreeAdapter", () => {
  test("has the expected name/description", () => {
    expect(WorktreeAdapter.name).toBe("Worktree")
    expect(WorktreeAdapter.description).toBe("Create a git worktree")
  })

  test("create() rejects info missing required worktree fields (directory/branch)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(WorktreeAdapter.create(baseInfo, {})).rejects.toThrow()
      },
    })
  })

  test("target() throws for info missing required worktree fields", () => {
    expect(() => WorktreeAdapter.target!(baseInfo)).toThrow()
  })

  test("target() returns a local target pointing at the decoded directory", () => {
    const info = { ...baseInfo, name: "feature-x", branch: "physicscode/feature-x", directory: "/tmp/worktrees/x" }
    expect(WorktreeAdapter.target!(info)).toEqual({ type: "local", directory: "/tmp/worktrees/x" })
  })

  test("configure() generates a name/branch/directory and create()/remove() manage a real worktree there", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const configured = await WorktreeAdapter.configure(baseInfo)
        expect(configured.name).toBeTruthy()
        expect(configured.branch).toBeTruthy()
        expect(configured.directory).toBeTruthy()
        // Everything else from the input is preserved unchanged.
        expect(configured.id).toBe(baseInfo.id)
        expect(configured.projectID).toBe(baseInfo.projectID)

        await WorktreeAdapter.create(configured, {})
        const { isDir } = await import("@/util/filesystem")
        expect(await isDir(configured.directory!)).toBe(true)

        await WorktreeAdapter.remove(configured)
        expect(await isDir(configured.directory!)).toBe(false)
      },
    })
  }, 30_000)
})
