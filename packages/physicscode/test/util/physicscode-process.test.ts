import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  PHYSICSCODE_PROCESS_ROLE,
  PHYSICSCODE_RUN_ID,
  ensureProcessMetadata,
  ensureProcessRole,
  ensureRunID,
  sanitizedProcessEnv,
} from "@physicscode-ai/core/util/physicscode-process"

const originalRunID = process.env[PHYSICSCODE_RUN_ID]
const originalRole = process.env[PHYSICSCODE_PROCESS_ROLE]

beforeEach(() => {
  delete process.env[PHYSICSCODE_RUN_ID]
  delete process.env[PHYSICSCODE_PROCESS_ROLE]
})

afterEach(() => {
  if (originalRunID === undefined) delete process.env[PHYSICSCODE_RUN_ID]
  else process.env[PHYSICSCODE_RUN_ID] = originalRunID
  if (originalRole === undefined) delete process.env[PHYSICSCODE_PROCESS_ROLE]
  else process.env[PHYSICSCODE_PROCESS_ROLE] = originalRole
})

describe("ensureRunID", () => {
  test("generates and persists a run id when unset", () => {
    expect(process.env[PHYSICSCODE_RUN_ID]).toBeUndefined()
    const id = ensureRunID()
    expect(id).toBeTruthy()
    expect(process.env[PHYSICSCODE_RUN_ID]).toBe(id)
  })

  test("returns the existing run id instead of generating a new one", () => {
    process.env[PHYSICSCODE_RUN_ID] = "fixed-run-id"
    expect(ensureRunID()).toBe("fixed-run-id")
  })

  test("is idempotent across repeated calls", () => {
    const first = ensureRunID()
    const second = ensureRunID()
    expect(second).toBe(first)
  })
})

describe("ensureProcessRole", () => {
  test("sets and returns the fallback role when unset", () => {
    expect(ensureProcessRole("worker")).toBe("worker")
    expect(process.env[PHYSICSCODE_PROCESS_ROLE]).toBe("worker")
  })

  test("returns the existing role, ignoring the fallback", () => {
    process.env[PHYSICSCODE_PROCESS_ROLE] = "main"
    expect(ensureProcessRole("worker")).toBe("main")
  })
})

describe("ensureProcessMetadata", () => {
  test("combines a fresh run id and process role", () => {
    const metadata = ensureProcessMetadata("main")
    expect(metadata.runID).toBeTruthy()
    expect(metadata.processRole).toBe("main")
    expect(process.env[PHYSICSCODE_RUN_ID]).toBe(metadata.runID)
    expect(process.env[PHYSICSCODE_PROCESS_ROLE]).toBe("main")
  })
})

describe("sanitizedProcessEnv", () => {
  test("drops entries with undefined values", () => {
    const env = sanitizedProcessEnv()
    expect(Object.values(env).every((value) => value !== undefined)).toBe(true)
  })

  test("includes real environment values", () => {
    process.env.PHYSICSCODE_TEST_SANITIZE_PROBE = "probe-value"
    try {
      const env = sanitizedProcessEnv()
      expect(env.PHYSICSCODE_TEST_SANITIZE_PROBE).toBe("probe-value")
    } finally {
      delete process.env.PHYSICSCODE_TEST_SANITIZE_PROBE
    }
  })

  test("applies overrides on top of the sanitized environment", () => {
    const env = sanitizedProcessEnv({ CUSTOM_KEY: "custom-value" })
    expect(env.CUSTOM_KEY).toBe("custom-value")
  })

  test("overrides take precedence over existing environment values", () => {
    process.env.PHYSICSCODE_TEST_SANITIZE_OVERRIDE = "original"
    try {
      const env = sanitizedProcessEnv({ PHYSICSCODE_TEST_SANITIZE_OVERRIDE: "overridden" })
      expect(env.PHYSICSCODE_TEST_SANITIZE_OVERRIDE).toBe("overridden")
    } finally {
      delete process.env.PHYSICSCODE_TEST_SANITIZE_OVERRIDE
    }
  })
})
