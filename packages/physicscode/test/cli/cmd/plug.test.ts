import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import yargs from "yargs"
import { Filesystem } from "@/util/filesystem"
import { PluginCommand } from "../../../src/cli/cmd/plug"
import { tmpdir } from "../../fixture/fixture"

async function plugin(dir: string) {
  const p = path.join(dir, "plugin")
  await fs.mkdir(p, { recursive: true })
  await Bun.write(
    p + "/package.json",
    JSON.stringify(
      {
        name: "acme",
        version: "1.0.0",
        main: "./server.js",
      },
      null,
      2,
    ),
  )
  return p
}

describe("cli.cmd.plug.PluginCommand", () => {
  afterEach(() => {
    process.exitCode = 0
  })

  test("builder registers module/global/force options", async () => {
    let seen: { module?: string; global?: boolean; force?: boolean } = {}
    await yargs(["plugin", "acme@1.2.3", "--global", "--force"])
      .command({
        ...PluginCommand,
        handler: (args) => {
          seen = args as typeof seen
        },
      })
      .parseAsync()
    expect(seen.module).toBe("acme@1.2.3")
    expect(seen.global).toBe(true)
    expect(seen.force).toBe(true)
  })

  test("builder defaults global/force to false", async () => {
    let seen: { global?: boolean; force?: boolean } = {}
    await yargs(["plugin", "acme@1.2.3"])
      .command({
        ...PluginCommand,
        handler: (args) => {
          seen = args as typeof seen
        },
      })
      .parseAsync()
    expect(seen.global).toBe(false)
    expect(seen.force).toBe(false)
  })

  test("handler fails fast when module is blank", async () => {
    // @ts-expect-error partial args are fine for this handler
    await PluginCommand.handler({ module: "   " })
    expect(process.exitCode).toBe(1)
  })

  test("handler installs a path-spec plugin into the current directory", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path)
    const cwd = process.cwd()
    try {
      process.chdir(tmp.path)
      // @ts-expect-error partial args are fine for this handler
      await PluginCommand.handler({ module: target })
    } finally {
      process.chdir(cwd)
    }
    expect(process.exitCode).toBe(0)
    expect(await Filesystem.exists(path.join(tmp.path, ".physicscode", "physicscode.json"))).toBe(true)
  })
})
