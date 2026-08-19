import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { ConfigManaged } from "@/config/managed"

const originalEnv = process.env.PHYSICSCODE_TEST_MANAGED_CONFIG_DIR
const originalPlatform = process.platform

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

afterEach(() => {
  if (originalEnv === undefined) delete process.env.PHYSICSCODE_TEST_MANAGED_CONFIG_DIR
  else process.env.PHYSICSCODE_TEST_MANAGED_CONFIG_DIR = originalEnv
  setPlatform(originalPlatform)
})

describe("config.ConfigManaged.managedConfigDir", () => {
  test("uses the test override env var when set", () => {
    process.env.PHYSICSCODE_TEST_MANAGED_CONFIG_DIR = "/tmp/fake-managed-dir"
    expect(ConfigManaged.managedConfigDir()).toBe("/tmp/fake-managed-dir")
  })

  test("falls back to the platform-specific system directory on darwin", () => {
    delete process.env.PHYSICSCODE_TEST_MANAGED_CONFIG_DIR
    setPlatform("darwin")
    expect(ConfigManaged.managedConfigDir()).toBe("/Library/Application Support/physicscode")
  })

  test("falls back to the platform-specific system directory on linux", () => {
    delete process.env.PHYSICSCODE_TEST_MANAGED_CONFIG_DIR
    setPlatform("linux")
    expect(ConfigManaged.managedConfigDir()).toBe("/etc/physicscode")
  })

  test("falls back to ProgramData on win32", () => {
    delete process.env.PHYSICSCODE_TEST_MANAGED_CONFIG_DIR
    setPlatform("win32")
    const original = process.env.ProgramData
    process.env.ProgramData = "D:\\ProgramData"
    try {
      expect(ConfigManaged.managedConfigDir()).toBe(path.join("D:\\ProgramData", "physicscode"))
    } finally {
      if (original === undefined) delete process.env.ProgramData
      else process.env.ProgramData = original
    }
  })
})

describe("config.ConfigManaged.parseManagedPlist", () => {
  test("strips MDM payload metadata keys", () => {
    const input = JSON.stringify({
      PayloadDisplayName: "PhysicsCode",
      PayloadIdentifier: "ai.physicscode.managed",
      PayloadType: "Configuration",
      PayloadUUID: "abc-123",
      PayloadVersion: 1,
      _manualProfile: true,
      disabled_providers: ["openai"],
    })

    const result = JSON.parse(ConfigManaged.parseManagedPlist(input))

    expect(result).toEqual({ disabled_providers: ["openai"] })
  })

  test("leaves non-metadata keys untouched when there is no metadata", () => {
    const input = JSON.stringify({ disabled_providers: ["openai"], enabled_providers: ["anthropic"] })
    const result = JSON.parse(ConfigManaged.parseManagedPlist(input))
    expect(result).toEqual({ disabled_providers: ["openai"], enabled_providers: ["anthropic"] })
  })

  test("throws for invalid JSON", () => {
    expect(() => ConfigManaged.parseManagedPlist("not json")).toThrow()
  })
})

describe("config.ConfigManaged.readManagedPreferences", () => {
  test("returns undefined immediately on non-darwin platforms", async () => {
    setPlatform("linux")
    expect(await ConfigManaged.readManagedPreferences()).toBeUndefined()
  })
})
