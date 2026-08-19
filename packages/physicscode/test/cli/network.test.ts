import { afterEach, describe, expect, test } from "bun:test"
import yargs from "yargs"
import { resolveNetworkOptions, resolveNetworkOptionsNoConfig, withNetworkOptions, type NetworkOptions } from "@/cli/network"

const originalArgv = process.argv

afterEach(() => {
  process.argv = originalArgv
})

function args(overrides: Partial<NetworkOptions> = {}): NetworkOptions {
  return {
    port: 0,
    hostname: "127.0.0.1",
    mdns: false,
    "mdns-domain": "physicscode.local",
    cors: [],
    ...overrides,
  }
}

describe("cli.network.resolveNetworkOptionsNoConfig", () => {
  test("uses the CLI defaults when nothing else is set", () => {
    process.argv = ["node", "physicscode"]
    const result = resolveNetworkOptionsNoConfig(args())
    expect(result).toEqual({ hostname: "127.0.0.1", port: 0, mdns: false, mdnsDomain: "physicscode.local", cors: [] })
  })

  test("config values override CLI defaults when the flag wasn't explicitly passed", () => {
    process.argv = ["node", "physicscode"]
    const result = resolveNetworkOptionsNoConfig(args(), {
      server: { port: 5000, hostname: "0.0.0.0", mdns: true, mdnsDomain: "custom.local", cors: ["https://a.example"] },
    } as any)
    expect(result).toEqual({
      hostname: "0.0.0.0",
      port: 5000,
      mdns: true,
      mdnsDomain: "custom.local",
      cors: ["https://a.example"],
    })
  })

  test("an explicitly-passed --port flag wins over config", () => {
    process.argv = ["node", "physicscode", "--port", "9999"]
    const result = resolveNetworkOptionsNoConfig(args({ port: 9999 }), { server: { port: 5000 } } as any)
    expect(result.port).toBe(9999)
  })

  test("an explicitly-passed --hostname flag wins over config", () => {
    process.argv = ["node", "physicscode", "--hostname", "1.2.3.4"]
    const result = resolveNetworkOptionsNoConfig(args({ hostname: "1.2.3.4" }), {
      server: { hostname: "0.0.0.0" },
    } as any)
    expect(result.hostname).toBe("1.2.3.4")
  })

  test("enabling mdns without an explicit hostname or config hostname defaults hostname to 0.0.0.0", () => {
    process.argv = ["node", "physicscode", "--mdns"]
    const result = resolveNetworkOptionsNoConfig(args({ mdns: true }))
    expect(result.hostname).toBe("0.0.0.0")
  })

  test("mdns does not override an explicit config hostname", () => {
    process.argv = ["node", "physicscode", "--mdns"]
    const result = resolveNetworkOptionsNoConfig(args({ mdns: true }), { server: { hostname: "10.0.0.5" } } as any)
    expect(result.hostname).toBe("10.0.0.5")
  })

  test("merges config cors entries with CLI-provided cors entries", () => {
    process.argv = ["node", "physicscode"]
    const result = resolveNetworkOptionsNoConfig(args({ cors: ["https://cli.example"] }), {
      server: { cors: ["https://config.example"] },
    } as any)
    expect(result.cors).toEqual(["https://config.example", "https://cli.example"])
  })

  test("wraps a single non-array cors value into an array", () => {
    process.argv = ["node", "physicscode"]
    const result = resolveNetworkOptionsNoConfig(args({ cors: "https://one.example" as any }))
    expect(result.cors).toEqual(["https://one.example"])
  })

  test("works with no config object at all", () => {
    process.argv = ["node", "physicscode"]
    const result = resolveNetworkOptionsNoConfig(args())
    expect(result).toEqual({ hostname: "127.0.0.1", port: 0, mdns: false, mdnsDomain: "physicscode.local", cors: [] })
  })
})

describe("cli.network.withNetworkOptions", () => {
  test("registers the network flags on a yargs instance", () => {
    const parsed = withNetworkOptions(yargs()).parseSync(["--port", "1234", "--hostname", "0.0.0.0"])
    expect(parsed.port).toBe(1234)
    expect(parsed.hostname).toBe("0.0.0.0")
    expect(parsed.mdns).toBe(false)
    expect(parsed["mdns-domain"]).toBe("physicscode.local")
  })
})

describe("cli.network.resolveNetworkOptions", () => {
  test("resolves against the real global config without throwing", async () => {
    process.argv = ["node", "physicscode"]
    const result = await resolveNetworkOptions(args())
    expect(typeof result.hostname).toBe("string")
    expect(typeof result.port).toBe("number")
    expect(Array.isArray(result.cors)).toBe(true)
  })
})
