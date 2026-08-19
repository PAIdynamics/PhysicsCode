import { mock } from "bun:test"
import * as realPrompts from "@clack/prompts"

// mock.module patches bun's shared module registry for the entire test
// process, not just the importing file - so there must be exactly ONE
// place in the whole suite that calls it for a given module, or whichever
// file's call runs last silently clobbers every other file's overrides.
// This is that one place for "@clack/prompts". Every export not
// explicitly overridden below passes through to the real module, so
// unrelated production code paths (log.error, text, etc.) keep working
// for every other test file regardless of load order.

export const CANCEL = Symbol("cancel")

export const clackMock = {
  calls: [] as Array<{ fn: string; args: unknown[] }>,
  spinnerCalls: [] as Array<{ fn: string; args: unknown[] }>,
  selectResult: "picked" as unknown,
  passwordResult: "fake-password" as unknown,
}

export function resetClackMock() {
  clackMock.calls = []
  clackMock.spinnerCalls = []
  clackMock.selectResult = "picked"
  clackMock.passwordResult = "fake-password"
}

void mock.module("@clack/prompts", () => ({
  ...realPrompts,
  intro: (...args: unknown[]) => clackMock.calls.push({ fn: "intro", args }),
  outro: (...args: unknown[]) => clackMock.calls.push({ fn: "outro", args }),
  log: {
    ...realPrompts.log,
    info: (...args: unknown[]) => clackMock.calls.push({ fn: "log.info", args }),
  },
  select: async (...args: unknown[]) => {
    clackMock.calls.push({ fn: "select", args })
    return clackMock.selectResult
  },
  password: async (...args: unknown[]) => {
    clackMock.calls.push({ fn: "password", args })
    return clackMock.passwordResult
  },
  isCancel: (value: unknown) => value === CANCEL,
  spinner: () => ({
    start: (...args: unknown[]) => clackMock.spinnerCalls.push({ fn: "start", args }),
    stop: (...args: unknown[]) => clackMock.spinnerCalls.push({ fn: "stop", args }),
  }),
}))
