import { describe, expect, test } from "bun:test"
import path from "path"
import { Typescript, Deno, Prisma } from "@/lsp/server"
import type { InstanceContext } from "@/project/instance"
import { tmpdir } from "../fixture/fixture"

// NearestRoot (the shared root-resolution helper behind almost every LSP's
// `root` function in server.ts) isn't exported directly, so it's exercised
// here through the exported Info objects that wrap it - Typescript.root has
// both include and exclude patterns, which covers both branches.
function ctxFor(directory: string): InstanceContext {
  return { directory, worktree: directory, project: {} as InstanceContext["project"] }
}

describe("lsp.server Typescript.root (NearestRoot)", () => {
  test("finds the nearest directory containing an include-pattern marker", async () => {
    await using dir = await tmpdir()
    await Bun.write(path.join(dir.path, "bun.lock"), "")
    const nested = path.join(dir.path, "src", "deep")
    await Bun.write(path.join(nested, "placeholder.ts"), "")

    const root = await Typescript.root(path.join(nested, "index.ts"), ctxFor(dir.path))
    expect(root).toBe(dir.path)
  })

  test("stops at the nearest marker, not the outermost one", async () => {
    await using dir = await tmpdir()
    await Bun.write(path.join(dir.path, "bun.lock"), "")
    const inner = path.join(dir.path, "packages", "app")
    await Bun.write(path.join(inner, "bun.lock"), "")
    await Bun.write(path.join(inner, "index.ts"), "")

    const root = await Typescript.root(path.join(inner, "index.ts"), ctxFor(dir.path))
    expect(root).toBe(inner)
  })

  test("falls back to ctx.directory when no marker is found", async () => {
    await using dir = await tmpdir()
    const nested = path.join(dir.path, "src")
    await Bun.write(path.join(nested, "index.ts"), "")

    const root = await Typescript.root(path.join(nested, "index.ts"), ctxFor(dir.path))
    expect(root).toBe(dir.path)
  })

  test("returns undefined when an exclude-pattern marker is found first", async () => {
    await using dir = await tmpdir()
    await Bun.write(path.join(dir.path, "bun.lock"), "")
    await Bun.write(path.join(dir.path, "deno.json"), "{}")
    const nested = path.join(dir.path, "src")
    await Bun.write(path.join(nested, "index.ts"), "")

    const root = await Typescript.root(path.join(nested, "index.ts"), ctxFor(dir.path))
    expect(root).toBeUndefined()
  })

  test("does not walk past ctx.directory", async () => {
    await using outer = await tmpdir()
    await Bun.write(path.join(outer.path, "bun.lock"), "")
    const inner = path.join(outer.path, "project")
    await Bun.write(path.join(inner, "index.ts"), "")

    // ctx.directory is the inner project, so the outer bun.lock is out of bounds
    const root = await Typescript.root(path.join(inner, "index.ts"), ctxFor(inner))
    expect(root).toBe(inner)
  })
})

describe("lsp.server Deno.root (NearestRoot without exclude patterns)", () => {
  test("finds a deno.json marker with no exclude patterns configured", async () => {
    await using dir = await tmpdir()
    await Bun.write(path.join(dir.path, "deno.json"), "{}")
    const nested = path.join(dir.path, "src")
    await Bun.write(path.join(nested, "mod.ts"), "")

    const root = await Deno.root(path.join(nested, "mod.ts"), ctxFor(dir.path))
    expect(root).toBe(dir.path)
  })
})

describe("lsp.server Info registry shape", () => {
  test("every LSP Info exposes id, extensions, root, and spawn", () => {
    for (const info of [Typescript, Deno, Prisma]) {
      expect(typeof info.id).toBe("string")
      expect(Array.isArray(info.extensions)).toBe(true)
      expect(info.extensions.length).toBeGreaterThan(0)
      expect(typeof info.root).toBe("function")
      expect(typeof info.spawn).toBe("function")
    }
  })

  test("Typescript covers the expected file extensions", () => {
    expect(Typescript.extensions).toEqual([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"])
  })
})
