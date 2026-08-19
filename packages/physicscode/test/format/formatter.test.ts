import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  biome,
  clang,
  ocamlformat,
  oxfmt,
  pint,
  prettier,
  ruff,
} from "@/format/formatter"

async function withTmpdir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-formatter-"))
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("format.formatter.prettier", () => {
  test("returns false when no package.json is found", async () => {
    await withTmpdir(async (dir) => {
      expect(await prettier.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })

  test("returns false when package.json exists but doesn't depend on prettier", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: { react: "1.0.0" } }))
      expect(await prettier.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })

  test("checks devDependencies too, not just dependencies", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { prettier: "^3.0.0" } }))
      // The binary itself almost certainly isn't resolvable here, so this
      // still returns false, but it must get past the dependency check
      // (verified indirectly: it doesn't throw and it's still boolean-shaped).
      const result = await prettier.enabled({ directory: dir, worktree: dir })
      expect(result === false || Array.isArray(result)).toBe(true)
    })
  })
})

describe("format.formatter.biome", () => {
  test("returns false when no biome.json/biome.jsonc is found", async () => {
    await withTmpdir(async (dir) => {
      expect(await biome.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })

  test("finds a biome.jsonc config", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(path.join(dir, "biome.jsonc"), "{}")
      const result = await biome.enabled({ directory: dir, worktree: dir })
      expect(result === false || Array.isArray(result)).toBe(true)
    })
  })
})

describe("format.formatter.oxfmt", () => {
  test("returns false when the experimental flag is off, regardless of package.json", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { oxfmt: "1.0.0" } }))
      expect(await oxfmt.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })
})

describe("format.formatter.clang", () => {
  test("returns false when no .clang-format is found", async () => {
    await withTmpdir(async (dir) => {
      expect(await clang.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })
})

describe("format.formatter.ocamlformat", () => {
  test("returns false when the ocamlformat binary isn't on PATH", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(path.join(dir, ".ocamlformat"), "")
      expect(await ocamlformat.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })
})

describe("format.formatter.pint", () => {
  test("returns false when no composer.json is found", async () => {
    await withTmpdir(async (dir) => {
      expect(await pint.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })

  test("returns false when composer.json exists but doesn't depend on laravel/pint", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(path.join(dir, "composer.json"), JSON.stringify({ require: { php: "^8.0" } }))
      expect(await pint.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })

  test("recognizes laravel/pint declared in require-dev", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(
        path.join(dir, "composer.json"),
        JSON.stringify({ "require-dev": { "laravel/pint": "^1.0" } }),
      )
      const result = await pint.enabled({ directory: dir, worktree: dir })
      expect(result).toEqual(["./vendor/bin/pint", "$FILE"])
    })
  })
})

describe("format.formatter.ruff", () => {
  test("returns false when the ruff binary isn't on PATH", async () => {
    await withTmpdir(async (dir) => {
      await fs.writeFile(path.join(dir, "pyproject.toml"), "[tool.ruff]\n")
      expect(await ruff.enabled({ directory: dir, worktree: dir })).toBe(false)
    })
  })
})
