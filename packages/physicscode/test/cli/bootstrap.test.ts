import { describe, expect, test } from "bun:test"
import { bootstrap } from "@/cli/bootstrap"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("cli.bootstrap", () => {
  test("provides an active Instance context to the callback and returns its result", async () => {
    await using tmp = await tmpdir({ git: true })

    const result = await bootstrap(tmp.path, async () => {
      expect(Instance.directory).toBe(tmp.path)
      return "callback result"
    })

    expect(result).toBe("callback result")
  })

  test("disposes the instance after the callback resolves", async () => {
    await using tmp = await tmpdir({ git: true })

    await bootstrap(tmp.path, async () => "done")

    // The instance is disposed once bootstrap() returns, so directory
    // access outside any active `Instance.provide` scope must fail.
    expect(() => Instance.directory).toThrow()
  })

  test("propagates an error thrown by the callback", async () => {
    await using tmp = await tmpdir({ git: true })

    await expect(bootstrap(tmp.path, async () => { throw new Error("callback failed") })).rejects.toThrow(
      "callback failed",
    )
  })

  test("disposes the instance even when the callback throws", async () => {
    await using tmp = await tmpdir({ git: true })

    await bootstrap(tmp.path, async () => {
      throw new Error("boom")
    }).catch(() => {})

    expect(() => Instance.directory).toThrow()
  })
})
