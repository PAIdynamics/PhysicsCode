import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigVariable } from "@/config/variable"
import { InvalidError } from "@/config/error"

const originalEnv = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
})

describe("config.ConfigVariable.substitute", () => {
  test("substitutes {env:VAR} with the environment variable's value", async () => {
    process.env.MY_TEST_VAR = "hello"
    const result = await ConfigVariable.substitute({
      type: "virtual",
      source: "inline",
      dir: "/tmp",
      text: "value: {env:MY_TEST_VAR}",
    })
    expect(result).toBe("value: hello")
  })

  test("substitutes a missing env var with an empty string", async () => {
    delete process.env.MY_MISSING_VAR
    const result = await ConfigVariable.substitute({
      type: "virtual",
      source: "inline",
      dir: "/tmp",
      text: "value: {env:MY_MISSING_VAR}",
    })
    expect(result).toBe("value: ")
  })

  test("returns the text unchanged when there are no substitutions", async () => {
    const result = await ConfigVariable.substitute({
      type: "virtual",
      source: "inline",
      dir: "/tmp",
      text: "plain text",
    })
    expect(result).toBe("plain text")
  })

  test("substitutes {file:path} with the trimmed file contents, resolved relative to the config dir", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-variable-"))
    try {
      await fs.writeFile(path.join(dir, "secret.txt"), "  shh-secret  \n")
      const result = await ConfigVariable.substitute({
        type: "virtual",
        source: "inline",
        dir,
        text: "key: {file:secret.txt}",
      })
      expect(result).toBe("key: shh-secret")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("resolves the config dir from a path source's dirname", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-variable-"))
    try {
      await fs.writeFile(path.join(dir, "secret.txt"), "from-path-source")
      const result = await ConfigVariable.substitute({
        type: "path",
        path: path.join(dir, "physicscode.json"),
        text: "key: {file:secret.txt}",
      })
      expect(result).toBe("key: from-path-source")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("expands a ~/ prefix to the home directory", async () => {
    const home = os.homedir()
    const marker = `physicscode-test-variable-${Date.now()}.txt`
    await fs.writeFile(path.join(home, marker), "home file content")
    try {
      const result = await ConfigVariable.substitute({
        type: "virtual",
        source: "inline",
        dir: "/tmp",
        text: `key: {file:~/${marker}}`,
      })
      expect(result).toBe("key: home file content")
    } finally {
      await fs.rm(path.join(home, marker), { force: true })
    }
  })

  test("skips {file:...} tokens on comment lines (// prefix)", async () => {
    const result = await ConfigVariable.substitute({
      type: "virtual",
      source: "inline",
      dir: "/tmp",
      text: "// key: {file:does-not-exist.txt}",
    })
    expect(result).toBe("// key: {file:does-not-exist.txt}")
  })

  test("throws InvalidError for a missing file by default", async () => {
    await expect(
      ConfigVariable.substitute({
        type: "virtual",
        source: "physicscode.json",
        dir: "/tmp",
        text: "key: {file:definitely-missing.txt}",
      }),
    ).rejects.toThrow(InvalidError)
  })

  test("substitutes an empty string for a missing file when missing='empty'", async () => {
    const result = await ConfigVariable.substitute({
      type: "virtual",
      source: "inline",
      dir: "/tmp",
      text: "key: {file:definitely-missing.txt}",
      missing: "empty",
    })
    expect(result).toBe("key: ")
  })

  test("JSON-escapes special characters in substituted file content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-variable-"))
    try {
      await fs.writeFile(path.join(dir, "quoted.txt"), 'has "quotes" and\nnewline')
      const result = await ConfigVariable.substitute({
        type: "virtual",
        source: "inline",
        dir,
        text: '{"key": "{file:quoted.txt}"}',
      })
      // The substituted content must itself be valid inside a JSON string.
      expect(JSON.parse(result)).toEqual({ key: 'has "quotes" and\nnewline' })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("handles multiple substitutions in the same text", async () => {
    process.env.MY_TEST_VAR = "envvalue"
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "physicscode-test-variable-"))
    try {
      await fs.writeFile(path.join(dir, "a.txt"), "filevalue")
      const result = await ConfigVariable.substitute({
        type: "virtual",
        source: "inline",
        dir,
        text: "{env:MY_TEST_VAR} and {file:a.txt}",
      })
      expect(result).toBe("envvalue and filevalue")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
