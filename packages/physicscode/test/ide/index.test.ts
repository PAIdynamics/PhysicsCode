import { afterEach, describe, expect, test } from "bun:test"
import { Ide } from "@/ide"

const ENV_KEYS = ["TERM_PROGRAM", "GIT_ASKPASS", "PHYSICSCODE_CALLER"] as const
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
})

describe("ide.ide", () => {
  test("returns 'unknown' when TERM_PROGRAM isn't vscode", () => {
    delete process.env.TERM_PROGRAM
    process.env.GIT_ASKPASS = "/usr/share/code/resources/app/extensions/git/dist/askpass.sh"
    expect(Ide.ide()).toBe("unknown")
  })

  test("returns 'unknown' in vscode when GIT_ASKPASS doesn't match a known IDE", () => {
    process.env.TERM_PROGRAM = "vscode"
    process.env.GIT_ASKPASS = "/some/other/tool/askpass.sh"
    expect(Ide.ide()).toBe("unknown")
  })

  test("returns 'unknown' in vscode when GIT_ASKPASS is unset", () => {
    process.env.TERM_PROGRAM = "vscode"
    delete process.env.GIT_ASKPASS
    expect(Ide.ide()).toBe("unknown")
  })

  test("detects Visual Studio Code from GIT_ASKPASS", () => {
    process.env.TERM_PROGRAM = "vscode"
    process.env.GIT_ASKPASS = "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/git/dist/askpass.sh"
    expect(Ide.ide()).toBe("Visual Studio Code")
  })

  test("detects Visual Studio Code - Insiders before the non-Insiders variant", () => {
    process.env.TERM_PROGRAM = "vscode"
    process.env.GIT_ASKPASS =
      "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/git/dist/askpass.sh"
    expect(Ide.ide()).toBe("Visual Studio Code - Insiders")
  })

  test("detects Cursor from GIT_ASKPASS", () => {
    process.env.TERM_PROGRAM = "vscode"
    process.env.GIT_ASKPASS = "/Applications/Cursor.app/Contents/Resources/app/extensions/git/dist/askpass.sh"
    expect(Ide.ide()).toBe("Cursor")
  })

  test("detects Windsurf from GIT_ASKPASS", () => {
    process.env.TERM_PROGRAM = "vscode"
    process.env.GIT_ASKPASS = "/Applications/Windsurf.app/Contents/Resources/app/extensions/git/dist/askpass.sh"
    expect(Ide.ide()).toBe("Windsurf")
  })

  test("detects VSCodium from GIT_ASKPASS", () => {
    process.env.TERM_PROGRAM = "vscode"
    process.env.GIT_ASKPASS = "/Applications/VSCodium.app/Contents/Resources/app/extensions/git/dist/askpass.sh"
    expect(Ide.ide()).toBe("VSCodium")
  })
})

describe("ide.alreadyInstalled", () => {
  test("true when PHYSICSCODE_CALLER is vscode", () => {
    process.env.PHYSICSCODE_CALLER = "vscode"
    expect(Ide.alreadyInstalled()).toBe(true)
  })

  test("true when PHYSICSCODE_CALLER is vscode-insiders", () => {
    process.env.PHYSICSCODE_CALLER = "vscode-insiders"
    expect(Ide.alreadyInstalled()).toBe(true)
  })

  test("false for any other caller", () => {
    process.env.PHYSICSCODE_CALLER = "cli"
    expect(Ide.alreadyInstalled()).toBe(false)
  })

  test("false when unset", () => {
    delete process.env.PHYSICSCODE_CALLER
    expect(Ide.alreadyInstalled()).toBe(false)
  })
})

describe("ide.install", () => {
  test("throws for an unrecognized IDE name", async () => {
    await expect(Ide.install("Not A Real IDE" as any)).rejects.toThrow("Unknown IDE: Not A Real IDE")
  })
})
