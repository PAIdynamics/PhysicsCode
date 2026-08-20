import { afterEach, describe, expect, test } from "bun:test"
import { Auth } from "@/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { ControlPlaneRoutes } from "@/server/routes/control"

afterEach(async () => {
  await AppRuntime.runPromise(Auth.Service.use((svc) => svc.remove("test-control-legacy-provider")))
})

describe("legacy ControlPlaneRoutes", () => {
  test("PUT /auth/:providerID stores credentials", async () => {
    const res = await ControlPlaneRoutes().request("/auth/test-control-legacy-provider", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api", key: "sk-test-legacy" }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)

    const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-control-legacy-provider")))
    expect(stored?.type).toBe("api")
    if (stored?.type === "api") expect(stored.key).toBe("sk-test-legacy")
  })

  test("DELETE /auth/:providerID removes stored credentials", async () => {
    await AppRuntime.runPromise(
      Auth.Service.use((svc) => svc.set("test-control-legacy-provider", { type: "api", key: "sk-x" })),
    )

    const res = await ControlPlaneRoutes().request("/auth/test-control-legacy-provider", { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)

    const stored = await AppRuntime.runPromise(Auth.Service.use((svc) => svc.get("test-control-legacy-provider")))
    expect(stored).toBeUndefined()
  })

  test("GET /doc serves the generated OpenAPI document", async () => {
    const res = await ControlPlaneRoutes().request("/doc")
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.info.title).toBe("physicscode")
  })

  test.each(["debug", "info", "error", "warn"] as const)("POST /log accepts level=%s", async (level) => {
    const res = await ControlPlaneRoutes().request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "test-service", level, message: `hello at ${level}` }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)
  })

  test("POST /log accepts extra metadata", async () => {
    const res = await ControlPlaneRoutes().request("/log", {
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
    const res = await ControlPlaneRoutes().request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "test-service", level: "not-a-level", message: "hi" }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
