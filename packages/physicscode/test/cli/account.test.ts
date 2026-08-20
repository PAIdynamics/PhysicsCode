import { describe, expect, test } from "bun:test"
import stripAnsi from "strip-ansi"
import { Effect, Layer, Option } from "effect"
import { CANCEL, clackMock, resetClackMock } from "../lib/clack-mock"
import { Account } from "@/account/account"
import { Info } from "@/account/schema"
import type { AccountID, OrgID } from "@/account/schema"

import {
  formatAccountLabel,
  formatOrgChoiceLabel,
  formatOrgLine,
  isActiveOrgChoice,
  loginWithApiKeyEffect,
  logoutEffect,
  orgsEffect,
  statusEffect,
} from "../../src/cli/cmd/account"

function account(overrides: Partial<{ id: string; email: string; url: string; active_org_id: string | null }> = {}) {
  return new Info({
    id: (overrides.id ?? "acc_1") as AccountID,
    email: overrides.email ?? "one@example.com",
    url: overrides.url ?? "https://one.example.com",
    active_org_id: (overrides.active_org_id ?? null) as OrgID | null,
  })
}

function fakeAccountService(overrides: Partial<Account.Interface>) {
  const notImplemented = (name: string) => () => Effect.die(new Error(`not implemented in fake: ${name}`))
  const base: Account.Interface = {
    active: notImplemented("active"),
    activeOrg: notImplemented("activeOrg"),
    list: notImplemented("list"),
    orgsByAccount: notImplemented("orgsByAccount"),
    remove: notImplemented("remove"),
    use: notImplemented("use"),
    orgs: notImplemented("orgs"),
    config: notImplemented("config"),
    billing: notImplemented("billing"),
    token: notImplemented("token"),
    login: notImplemented("login"),
    loginWithApiKey: notImplemented("loginWithApiKey"),
    poll: notImplemented("poll"),
  }
  return Layer.succeed(Account.Service, Account.Service.of({ ...base, ...overrides }))
}

describe("console account display", () => {
  test("includes the account url in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, false))).toBe(
      "one@example.com https://one.example.com",
    )
  })

  test("includes the active marker in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, true))).toBe(
      "one@example.com https://one.example.com (active)",
    )
  })

  test("includes the account url in org rows", () => {
    expect(
      stripAnsi(
        formatOrgLine({ email: "one@example.com", url: "https://one.example.com" }, { id: "org-1", name: "One" }, true),
      ),
    ).toBe("  ● One  one@example.com  https://one.example.com  org-1")
  })

  test("uses a blank marker instead of a dot for a non-active org row", () => {
    expect(
      stripAnsi(
        formatOrgLine({ email: "one@example.com", url: "https://one.example.com" }, { id: "org-1", name: "One" }, false),
      ),
    ).toBe("    One  one@example.com  https://one.example.com  org-1")
  })

  test("formatOrgChoiceLabel includes the active marker only when active", () => {
    expect(stripAnsi(formatOrgChoiceLabel({ email: "one@example.com" }, { name: "One" }, false))).toBe(
      "One (one@example.com)",
    )
    expect(stripAnsi(formatOrgChoiceLabel({ email: "one@example.com" }, { name: "One" }, true))).toBe(
      "One (one@example.com) (active)",
    )
  })
})

describe("console account.isActiveOrgChoice", () => {
  const choice = { accountID: "acc_1" as AccountID, orgID: "org_1" as OrgID }

  test("false when there is no active account", () => {
    expect(isActiveOrgChoice(Option.none(), choice)).toBe(false)
  })

  test("false when the active account doesn't match", () => {
    const active = Option.some({ id: "acc_2" as AccountID, active_org_id: "org_1" as OrgID })
    expect(isActiveOrgChoice(active, choice)).toBe(false)
  })

  test("false when the account matches but the org doesn't", () => {
    const active = Option.some({ id: "acc_1" as AccountID, active_org_id: "org_2" as OrgID })
    expect(isActiveOrgChoice(active, choice)).toBe(false)
  })

  test("true when both account and org match", () => {
    const active = Option.some({ id: "acc_1" as AccountID, active_org_id: "org_1" as OrgID })
    expect(isActiveOrgChoice(active, choice)).toBe(true)
  })
})

describe("console account.loginWithApiKeyEffect", () => {
  test("logs in and returns the account via the service", async () => {
    let received: [string, string] | undefined
    const layer = fakeAccountService({
      loginWithApiKey: (url, apiKey) => {
        received = [url, apiKey]
        return Effect.succeed(account({ email: "key@example.com" }))
      },
    })
    await Effect.runPromise(loginWithApiKeyEffect("https://console.example", "sk-123").pipe(Effect.provide(layer)))
    expect(received).toEqual(["https://console.example", "sk-123"])
  })
})

describe("console account.logoutEffect", () => {
  test("reports when there are no accounts", async () => {
    const layer = fakeAccountService({ list: () => Effect.succeed([]) })
    // Should complete without throwing (and without needing active()/remove()).
    await Effect.runPromise(logoutEffect(undefined).pipe(Effect.provide(layer)))
  })

  test("reports when the given email isn't found", async () => {
    const layer = fakeAccountService({ list: () => Effect.succeed([account()]) })
    await Effect.runPromise(logoutEffect("missing@example.com").pipe(Effect.provide(layer)))
  })

  test("removes the matching account by email", async () => {
    let removedID: string | undefined
    const layer = fakeAccountService({
      list: () => Effect.succeed([account({ id: "acc_1", email: "one@example.com" })]),
      remove: (id) => {
        removedID = id
        return Effect.void
      },
    })
    await Effect.runPromise(logoutEffect("one@example.com").pipe(Effect.provide(layer)))
    expect(removedID).toBe("acc_1")
  })

  test("without an email, prompts for a choice and removes the selected account", async () => {
    resetClackMock()
    clackMock.selectResult = account({ id: "acc_2", email: "two@example.com" })

    let removedID: string | undefined
    const layer = fakeAccountService({
      list: () => Effect.succeed([account({ id: "acc_1" }), account({ id: "acc_2", email: "two@example.com" })]),
      active: () => Effect.succeed(Option.none()),
      remove: (id) => {
        removedID = id
        return Effect.void
      },
    })
    await Effect.runPromise(logoutEffect(undefined).pipe(Effect.provide(layer)))
    expect(removedID).toBe("acc_2")
  })

  test("without an email, does nothing when the account choice is cancelled", async () => {
    resetClackMock()
    clackMock.selectResult = CANCEL

    let removeCalled = false
    const layer = fakeAccountService({
      list: () => Effect.succeed([account()]),
      active: () => Effect.succeed(Option.none()),
      remove: () => {
        removeCalled = true
        return Effect.void
      },
    })
    await Effect.runPromise(logoutEffect(undefined).pipe(Effect.provide(layer)))
    expect(removeCalled).toBe(false)
  })

  test("without an email, marks the active account's option as active", async () => {
    resetClackMock()
    const active = account({ id: "acc_1" })
    clackMock.selectResult = active

    const layer = fakeAccountService({
      list: () => Effect.succeed([active]),
      active: () => Effect.succeed(Option.some(active)),
      remove: () => Effect.void,
    })
    await Effect.runPromise(logoutEffect(undefined).pipe(Effect.provide(layer)))

    const selectCall = clackMock.calls.find((c) => c.fn === "select")
    const options = (selectCall?.args[0] as { options: Array<{ label: string }> }).options
    expect(options[0].label).toContain("(active)")
  })
})

describe("console account.orgsEffect", () => {
  test("reports when there are no accounts at all", async () => {
    const layer = fakeAccountService({ orgsByAccount: () => Effect.succeed([]) })
    await Effect.runPromise(orgsEffect().pipe(Effect.provide(layer)))
  })

  test("reports when accounts exist but have no orgs", async () => {
    const layer = fakeAccountService({
      orgsByAccount: () => Effect.succeed([{ account: account(), orgs: [] }]),
    })
    await Effect.runPromise(orgsEffect().pipe(Effect.provide(layer)))
  })

  test("prints each org for each account", async () => {
    const layer = fakeAccountService({
      orgsByAccount: () =>
        Effect.succeed([{ account: account(), orgs: [{ id: "org_1" as OrgID, name: "Acme" }] }]),
      active: () => Effect.succeed(Option.none()),
    })
    await Effect.runPromise(orgsEffect().pipe(Effect.provide(layer)))
  })
})

describe("console account.statusEffect", () => {
  test("reports logged out as plain text", async () => {
    const layer = fakeAccountService({ active: () => Effect.succeed(Option.none()) })
    await Effect.runPromise(statusEffect(false).pipe(Effect.provide(layer)))
  })

  test("reports logged out as JSON", async () => {
    const layer = fakeAccountService({ active: () => Effect.succeed(Option.none()) })
    await Effect.runPromise(statusEffect(true).pipe(Effect.provide(layer)))
  })

  test("reports the active account as JSON", async () => {
    const layer = fakeAccountService({
      active: () => Effect.succeed(Option.some(account({ email: "active@example.com" }))),
    })
    await Effect.runPromise(statusEffect(true).pipe(Effect.provide(layer)))
  })

  test("reports the active account as plain text", async () => {
    const layer = fakeAccountService({
      active: () => Effect.succeed(Option.some(account({ email: "active@example.com" }))),
    })
    await Effect.runPromise(statusEffect(false).pipe(Effect.provide(layer)))
  })
})
