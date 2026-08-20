import { describe, expect, test } from "bun:test"
import { Duration } from "effect"
import { Account } from "@/account/account"
import {
  fromWireLogin,
  toWireAccount,
  toWireLogin,
  toWirePollResult,
} from "@/server/routes/instance/experimental"

describe("server.routes.instance.experimental wire helpers", () => {
  test("toWireLogin converts durations to milliseconds", () => {
    const login = Account.Login.make({
      code: Account.DeviceCode.make("device-code"),
      user: Account.UserCode.make("USER-CODE"),
      url: "https://console.example.com/device",
      server: "https://console.example.com",
      expiry: Duration.minutes(15),
      interval: Duration.seconds(5),
    })

    expect(toWireLogin(login)).toEqual({
      code: "device-code",
      user: "USER-CODE",
      url: "https://console.example.com/device",
      server: "https://console.example.com",
      expiryMs: 15 * 60 * 1000,
      intervalMs: 5 * 1000,
    } as ReturnType<typeof toWireLogin>)
  })

  test("fromWireLogin is the inverse of toWireLogin", () => {
    const wire = {
      code: "device-code",
      user: "USER-CODE",
      url: "https://console.example.com/device",
      server: "https://console.example.com",
      expiryMs: 900_000,
      intervalMs: 5_000,
    }

    const login = fromWireLogin(wire)
    expect(toWireLogin(login)).toEqual(wire as ReturnType<typeof toWireLogin>)
  })

  test.each([
    [new Account.PollSuccess({ email: "user@example.com" }), { status: "success", email: "user@example.com" }],
    [new Account.PollPending(), { status: "pending" }],
    [new Account.PollSlow(), { status: "slow" }],
    [new Account.PollExpired(), { status: "expired" }],
    [new Account.PollDenied(), { status: "denied" }],
    [new Account.PollError({ cause: "boom" }), { status: "error", message: "boom" }],
  ] as const)("toWirePollResult maps %s", (result, expected) => {
    expect(toWirePollResult(result)).toEqual(expected)
  })

  test("toWireAccount projects the wire-relevant account fields", () => {
    const info = Account.Info.make({
      id: Account.AccountID.make("acc_1"),
      email: "user@example.com",
      url: "https://console.example.com",
      active_org_id: Account.OrgID.make("org_1"),
    })

    expect(toWireAccount(info)).toEqual({
      id: "acc_1",
      email: "user@example.com",
      url: "https://console.example.com",
      activeOrgID: "org_1",
    })
  })

  test("toWireAccount keeps a null activeOrgID when there is no active org", () => {
    const info = Account.Info.make({
      id: Account.AccountID.make("acc_1"),
      email: "user@example.com",
      url: "https://console.example.com",
      active_org_id: null,
    })

    expect(toWireAccount(info).activeOrgID).toBeNull()
  })
})
