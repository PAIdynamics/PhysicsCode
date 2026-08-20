import { describe, expect, test } from "bun:test"
import { getAdapter, listAdapters, registerAdapter } from "../../src/control-plane/adapters"
import { ProjectID } from "../../src/project/schema"
import type { WorkspaceInfo } from "../../src/control-plane/types"

function info(projectID: WorkspaceInfo["projectID"], type: string): WorkspaceInfo {
  return {
    id: "workspace-test" as WorkspaceInfo["id"],
    type,
    name: "workspace-test",
    branch: null,
    directory: null,
    extra: null,
    projectID,
  }
}

function adapter(dir: string) {
  return {
    name: dir,
    description: dir,
    configure(input: WorkspaceInfo) {
      return input
    },
    async create() {},
    async remove() {},
    target() {
      return {
        type: "local" as const,
        directory: dir,
      }
    },
  }
}

describe("control-plane/adapters", () => {
  test("isolates custom adapters by project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const one = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    const two = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(one, type, adapter("/one"))
    registerAdapter(two, type, adapter("/two"))

    expect(await (await getAdapter(one, type)).target(info(one, type))).toEqual({
      type: "local",
      directory: "/one",
    })
    expect(await (await getAdapter(two, type)).target(info(two, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })

  test("latest install wins within a project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(id, type, adapter("/one"))

    expect(await (await getAdapter(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/one",
    })

    registerAdapter(id, type, adapter("/two"))

    expect(await (await getAdapter(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })

  test("falls back to the builtin worktree adapter when nothing custom is registered", () => {
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    expect(getAdapter(id, "worktree").name).toBe("Worktree")
  })

  test("throws for an unknown adapter type with no custom registration", () => {
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    expect(() => getAdapter(id, "not-a-real-type")).toThrow("Unknown workspace adapter: not-a-real-type")
  })

  test("listAdapters includes the builtin worktree adapter for a project with nothing custom registered", async () => {
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    const list = await listAdapters(id)
    expect(list.map((a) => a.type)).toEqual(["worktree"])
  })

  test("listAdapters includes both builtin and custom adapters for a project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(id, type, adapter("/custom"))

    const list = await listAdapters(id)
    expect(list.map((a) => a.type)).toContain("worktree")
    expect(list.map((a) => a.type)).toContain(type)
    expect(list.find((a) => a.type === type)).toEqual({ type, name: "/custom", description: "/custom" })
  })

  test("listAdapters doesn't leak custom adapters registered under a different project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const registeredIn = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    const queriedFor = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(registeredIn, type, adapter("/custom"))

    const list = await listAdapters(queriedFor)
    expect(list.map((a) => a.type)).not.toContain(type)
  })
})
