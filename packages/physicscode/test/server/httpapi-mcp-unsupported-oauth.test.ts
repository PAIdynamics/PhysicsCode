import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@physicscode-ai/core/flag/flag"
import { Instance } from "@/project/instance"
import { Server } from "@/server/server"
import { tmpdir } from "../fixture/fixture"

// Fills the one gap httpapi-mcp-oauth.test.ts leaves: that file replaces
// mcpHandlers entirely with stubs to test the middleware stack, so the
// real handlers/mcp.ts logic - specifically authStart/authAuthenticate's
// "this MCP server doesn't support OAuth" guard - is never actually
// exercised. A server name with no MCP config at all is the simplest way
// to hit that branch for real, without needing a working OAuth-capable
// MCP server.

const original = Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

afterEach(async () => {
  Flag.PHYSICSCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
})

describe("mcp HttpApi unsupported-OAuth guard", () => {
  test("POST /mcp/:name/auth returns an error for a server with no OAuth support", async () => {
    await using tmp = await tmpdir()
    const res = await app().request("/mcp/not-configured/auth", {
      method: "POST",
      headers: { "x-physicscode-directory": tmp.path },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain("does not support OAuth")
  })

  test("POST /mcp/:name/auth/authenticate returns an error for a server with no OAuth support", async () => {
    await using tmp = await tmpdir()
    const res = await app().request("/mcp/not-configured/auth/authenticate", {
      method: "POST",
      headers: { "x-physicscode-directory": tmp.path },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain("does not support OAuth")
  })
})
