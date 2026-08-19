import { afterEach, describe, expect, test } from "bun:test"
import { createServer } from "http"
import { McpOAuthCallback } from "@/mcp/oauth-callback"

let nextPort = 39001
function port() {
  return nextPort++
}
function redirectUri(p: number) {
  return `http://127.0.0.1:${p}/mcp/oauth/callback`
}

afterEach(async () => {
  await McpOAuthCallback.stop()
})

describe("mcp.McpOAuthCallback", () => {
  test("ensureRunning starts a server that isRunning() reflects", async () => {
    expect(McpOAuthCallback.isRunning()).toBe(false)
    await McpOAuthCallback.ensureRunning(redirectUri(port()))
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("a request to an unknown path returns 404", async () => {
    const p = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p))

    const res = await fetch(`http://127.0.0.1:${p}/wrong/path`)
    expect(res.status).toBe(404)
  })

  test("resolves the pending promise when a matching code+state callback arrives", async () => {
    const p = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p))

    const pending = McpOAuthCallback.waitForCallback("state-1")
    const res = await fetch(`http://127.0.0.1:${p}/mcp/oauth/callback?code=auth-code-1&state=state-1`)

    expect(res.status).toBe(200)
    expect(await pending).toBe("auth-code-1")
  })

  test("rejects with a CSRF error when state is missing", async () => {
    const p = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p))

    const res = await fetch(`http://127.0.0.1:${p}/mcp/oauth/callback?code=abc`)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("potential CSRF attack")
  })

  test("rejects the pending promise when the provider reports an error", async () => {
    const p = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p))

    // Attach the rejection handler immediately (rather than after the
    // fetch below resolves) so there's no window where the rejection is
    // unhandled - the callback server rejects `pending` synchronously
    // while handling the incoming request, which races the fetch promise.
    const pendingError = McpOAuthCallback.waitForCallback("state-err").then(
      () => null,
      (e: unknown) => e,
    )
    const res = await fetch(
      `http://127.0.0.1:${p}/mcp/oauth/callback?state=state-err&error=access_denied&error_description=User+said+no`,
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toContain("User said no")
    expect(await pendingError).toBeInstanceOf(Error)
    expect((await pendingError as Error).message).toBe("User said no")
  })

  test("returns 400 when no code and no error is provided", async () => {
    const p = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p))

    const res = await fetch(`http://127.0.0.1:${p}/mcp/oauth/callback?state=state-2`)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("No authorization code provided")
  })

  test("returns 400 for a state that has no pending auth", async () => {
    const p = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p))

    const res = await fetch(`http://127.0.0.1:${p}/mcp/oauth/callback?code=abc&state=never-registered`)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("Invalid or expired state")
  })

  test("cancelPending rejects the pending promise for the given mcp name", async () => {
    const pending = McpOAuthCallback.waitForCallback("state-cancel", "my-mcp-server")
    McpOAuthCallback.cancelPending("my-mcp-server")
    await expect(pending).rejects.toThrow("Authorization cancelled")
  })

  test("stop() rejects all pending callbacks and clears isRunning", async () => {
    await McpOAuthCallback.ensureRunning(redirectUri(port()))
    // Attach immediately - stop() awaits closing the server before
    // rejecting pending callbacks, so there's a real async gap between
    // creating this promise and `await McpOAuthCallback.stop()` returning.
    const pendingError = McpOAuthCallback.waitForCallback("state-stop").then(
      () => null,
      (e: unknown) => e,
    )

    await McpOAuthCallback.stop()

    expect(McpOAuthCallback.isRunning()).toBe(false)
    expect((await pendingError as Error).message).toBe("OAuth callback server stopped")
  })

  test("isPortInUse reflects a real listener on that port", async () => {
    const p = port()
    expect(await McpOAuthCallback.isPortInUse(p)).toBe(false)

    await McpOAuthCallback.ensureRunning(redirectUri(p))
    expect(await McpOAuthCallback.isPortInUse(p)).toBe(true)
  })

  test("ensureRunning defers to an already-running listener on the same port instead of erroring", async () => {
    const p = port()
    const foreign = createServer((_req, res) => res.end("foreign"))
    await new Promise<void>((resolve) => foreign.listen(p, resolve))

    try {
      await McpOAuthCallback.ensureRunning(redirectUri(p))
      // The module didn't take ownership of this port, so it has no
      // managed server of its own.
      expect(McpOAuthCallback.isRunning()).toBe(false)
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()))
    }
  })

  test("ensureRunning reconfigures to a new port when called again with a different redirect URI", async () => {
    const p1 = port()
    const p2 = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p1))
    expect(await McpOAuthCallback.isPortInUse(p1)).toBe(true)

    await McpOAuthCallback.ensureRunning(redirectUri(p2))

    expect(await McpOAuthCallback.isPortInUse(p1)).toBe(false)
    expect(await McpOAuthCallback.isPortInUse(p2)).toBe(true)
  })

  test("ensureRunning is a no-op when already running on the same port/path", async () => {
    const p = port()
    await McpOAuthCallback.ensureRunning(redirectUri(p))
    await McpOAuthCallback.ensureRunning(redirectUri(p))
    expect(McpOAuthCallback.isRunning()).toBe(true)
    expect(await McpOAuthCallback.isPortInUse(p)).toBe(true)
  })
})
