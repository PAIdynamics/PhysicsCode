import { afterEach, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Protected } from "@/file/protected"

const originalPlatform = process.platform

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

afterEach(() => {
  setPlatform(originalPlatform)
})

describe("file.Protected.names", () => {
  test("returns the macOS TCC-protected directory names on darwin", () => {
    setPlatform("darwin")
    const names = Protected.names()
    expect(names.has("Downloads")).toBe(true)
    expect(names.has("Library")).toBe(true)
    expect(names.has("Desktop")).toBe(true)
  })

  test("returns the Windows protected directory names on win32", () => {
    setPlatform("win32")
    const names = Protected.names()
    expect(names.has("AppData")).toBe(true)
    expect(names.has("OneDrive")).toBe(true)
  })

  test("returns an empty set on other platforms", () => {
    setPlatform("linux")
    expect(Protected.names().size).toBe(0)
  })
})

describe("file.Protected.paths", () => {
  test("returns absolute macOS paths under the home directory plus root-level entries", () => {
    setPlatform("darwin")
    const paths = Protected.paths()
    const home = os.homedir()

    expect(paths).toContain(path.join(home, "Downloads"))
    expect(paths).toContain(path.join(home, "Library", "Mail"))
    expect(paths).toContain("/.Trashes")
  })

  test("returns absolute Windows paths under the home directory", () => {
    setPlatform("win32")
    const paths = Protected.paths()
    const home = os.homedir()

    expect(paths).toContain(path.join(home, "AppData"))
    expect(paths).toContain(path.join(home, "Documents"))
    expect(paths.every((p) => p.startsWith(home))).toBe(true)
  })

  test("returns an empty array on other platforms", () => {
    setPlatform("linux")
    expect(Protected.paths()).toEqual([])
  })
})
