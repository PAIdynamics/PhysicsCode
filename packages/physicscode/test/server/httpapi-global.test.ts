import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@physicscode-ai/core/flag/flag"
import { InstallationVersion } from "@physicscode-ai/core/installation/version"
import { Server } from "@/server/server"

// Same pattern as httpapi-question.test.ts / httpapi-permission.test.ts,
// applied to the "global" group (not directory-scoped, so no
// x-physicscode-directory header is needed). configGet/configUpdate are
// safe to exercise for real here because the whole suite already runs
// with PHYSICSCODE_TEST_HOME sandboxed to a fake home dir (see
// test/preload.ts), so global config reads/writes never touch a real
// user's config. dispose (calls Instance.disposeAll() - would interfere
// with any other test running in the same process) and upgrade (shells
// out to real installation download/version-resolution logic) are left
// untested as unsafe/environment-dependent, matching the pattern used
// elsewhere for real network/process-dependent code paths.

const original = Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

afterEach(() => {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = original
})

describe("global HttpApi", () => {
  test("GET /global/health reports healthy with the installed version", async () => {
    const res = await app().request("/global/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ healthy: true, version: InstallationVersion })
  })

  test("GET /global/config returns the global config", async () => {
    const res = await app().request("/global/config")
    expect(res.status).toBe(200)
    const config = await res.json()
    expect(typeof config).toBe("object")
  })

  test("PATCH /global/config round-trips an updated global config value", async () => {
    const getRes = await app().request("/global/config")
    const current = await getRes.json()

    const updateRes = await app().request("/global/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...current, autoshare: true }),
    })
    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json()
    expect(updated.autoshare).toBe(true)

    const verifyRes = await app().request("/global/config")
    expect((await verifyRes.json()).autoshare).toBe(true)
  })
})
