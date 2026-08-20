import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@physicscode-ai/core/flag/flag"
import { Auth } from "@/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { Server } from "@/server/server"

// Same pattern as the other httpapi-*.test.ts files: controlHandlers is
// pure route registration delegating to Auth.Service, only meaningfully
// exercised through the real in-process server. Global (not
// directory-scoped), and safe to exercise for real - Auth storage is
// already used directly (unsandboxed risk aside) throughout
// test/cli/cmd/providers.test.ts and test/cli/account.test.ts elsewhere
// in this suite.

const original = Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

afterEach(async () => {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = original
  await AppRuntime.runPromise(Auth.Service.use((svc) => svc.remove("test-control-provider")))
})

describe("control HttpApi", () => {
  test("PUT /auth/:providerID stores credentials", async () => {
    const res = await app().request("/auth/test-control-provider", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api", key: "sk-test-control" }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)

    const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-control-provider")))
    expect(stored?.type).toBe("api")
    if (stored?.type === "api") expect(stored.key).toBe("sk-test-control")
  })

  test("DELETE /auth/:providerID removes stored credentials", async () => {
    await AppRuntime.runPromise(Auth.Service.use((svc) => svc.set("test-control-provider", { type: "api", key: "sk-x" })))

    const res = await app().request("/auth/test-control-provider", { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)

    const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-control-provider")))
    expect(stored).toBeUndefined()
  })

  test("POST /log accepts a structured log entry", async () => {
    const res = await app().request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "test-service", level: "info", message: "hello from a test" }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)
  })

  test("POST /log accepts extra metadata", async () => {
    const res = await app().request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        service: "test-service",
        level: "error",
        message: "boom",
        extra: { code: 500 },
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)
  })

  test("POST /log rejects an invalid log level", async () => {
    const res = await app().request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "test-service", level: "not-a-level", message: "hi" }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
