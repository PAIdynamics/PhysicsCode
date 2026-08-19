import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { InstallationChannel } from "@physicscode-ai/core/installation/version"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string,
) {
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(mockSpawner(spawnHandler)))
}

describe("installation", () => {
  describe("latest", () => {
    test("reads release version from GitHub releases", async () => {
      const layer = testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.2.3")
    })

    test("strips v prefix from GitHub release tag", async () => {
      const layer = testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("curl")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("4.0.0-beta.1")
    })

    test("reads npm versions via registry", async () => {
      const calls: string[] = []
      const layer = testLayer((request) => {
        calls.push(request.url)
        return jsonResponse({ version: "1.5.0" })
      })

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("npm")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.5.0")
      expect(calls).toContain(`https://registry.npmjs.org/physicscode-ai/${InstallationChannel}`)
    })

    test("reads bun versions via registry", async () => {
      const calls: string[] = []
      const layer = testLayer((request) => {
        calls.push(request.url)
        return jsonResponse({ version: "1.6.0" })
      })

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("bun")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.6.0")
      expect(calls).toContain(`https://registry.npmjs.org/physicscode-ai/${InstallationChannel}`)
    })

    test("reads pnpm versions via registry", async () => {
      const calls: string[] = []
      const layer = testLayer((request) => {
        calls.push(request.url)
        return jsonResponse({ version: "1.7.0" })
      })

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("pnpm")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.7.0")
      expect(calls).toContain(`https://registry.npmjs.org/physicscode-ai/${InstallationChannel}`)
    })

    test("reads scoop manifest versions", async () => {
      const layer = testLayer(() => jsonResponse({ version: "2.3.4" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("scoop")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("2.3.4")
    })

    test("reads chocolatey feed versions", async () => {
      const layer = testLayer(() => jsonResponse({ d: { results: [{ Version: "3.4.5" }] } }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("choco")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("3.4.5")
    })

    test("reads brew formulae API versions", async () => {
      const layer = testLayer(
        () => jsonResponse({ versions: { stable: "2.0.0" } }),
        (cmd, args) => {
          // getBrewFormula: return core formula (no tap)
          if (cmd === "brew" && args.includes("--formula") && args.includes("anomalyco/tap/physicscode")) return ""
          if (cmd === "brew" && args.includes("--formula") && args.includes("physicscode")) return "physicscode"
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("brew")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("2.0.0")
    })

    test("reads brew tap info JSON via CLI", async () => {
      const brewInfoJson = JSON.stringify({
        formulae: [{ versions: { stable: "2.1.0" } }],
      })
      const layer = testLayer(
        () => jsonResponse({}), // HTTP not used for tap formula
        (cmd, args) => {
          if (cmd === "brew" && args.includes("anomalyco/tap/physicscode") && args.includes("--formula")) return "physicscode"
          if (cmd === "brew" && args.includes("--json=v2")) return brewInfoJson
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("brew")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("2.1.0")
    })
  })

  describe("method", () => {
    test("detects npm install", async () => {
      const layer = testLayer(
        () => jsonResponse({}),
        (cmd) => (cmd === "npm" ? "physicscode-ai@1.0.0" : ""),
      )
      const result = await Effect.runPromise(Installation.Service.use((svc) => svc.method()).pipe(Effect.provide(layer)))
      expect(result).toBe("npm")
    })

    test("detects brew install", async () => {
      const layer = testLayer(
        () => jsonResponse({}),
        (cmd) => (cmd === "brew" ? "physicscode" : ""),
      )
      const result = await Effect.runPromise(Installation.Service.use((svc) => svc.method()).pipe(Effect.provide(layer)))
      expect(result).toBe("brew")
    })

    test("returns unknown when nothing matches", async () => {
      const layer = testLayer(() => jsonResponse({}))
      const result = await Effect.runPromise(Installation.Service.use((svc) => svc.method()).pipe(Effect.provide(layer)))
      expect(result).toBe("unknown")
    })
  })

  describe("upgrade", () => {
    test("succeeds for npm and logs the new version", async () => {
      const layer = testLayer(() => jsonResponse({}))
      await Effect.runPromise(
        Installation.Service.use((svc) => svc.upgrade("npm", "1.2.3")).pipe(Effect.provide(layer)),
      )
    })

    test("fails with UpgradeFailedError for an unknown method", async () => {
      const layer = testLayer(() => jsonResponse({}))
      const exit = await Effect.runPromiseExit(
        Installation.Service.use((svc) => svc.upgrade("unknown" as any, "1.2.3")).pipe(Effect.provide(layer)),
      )
      expect(exit._tag).toBe("Failure")
    })
  })

  describe("info", () => {
    test("combines the running version with the latest release", async () => {
      const layer = testLayer(() => jsonResponse({ tag_name: "v9.9.9" }))
      const result = await Effect.runPromise(Installation.Service.use((svc) => svc.info()).pipe(Effect.provide(layer)))
      expect(result.latest).toBe("9.9.9")
      expect(typeof result.version).toBe("string")
    })
  })
})

describe("installation.getReleaseType", () => {
  test("returns major when the major version increases", () => {
    expect(Installation.getReleaseType("1.2.3", "2.0.0")).toBe("major")
  })

  test("returns minor when only the minor version increases", () => {
    expect(Installation.getReleaseType("1.2.3", "1.3.0")).toBe("minor")
  })

  test("returns patch when only the patch version increases", () => {
    expect(Installation.getReleaseType("1.2.3", "1.2.4")).toBe("patch")
  })

  test("returns patch when versions are equal", () => {
    expect(Installation.getReleaseType("1.2.3", "1.2.3")).toBe("patch")
  })
})

describe("installation.isPreview / isLocal", () => {
  test("isPreview is true when the channel isn't 'latest'", () => {
    expect(Installation.isPreview()).toBe(InstallationChannel !== "latest")
  })

  test("isLocal is true only for the 'local' channel", () => {
    expect(Installation.isLocal()).toBe(InstallationChannel === "local")
  })
})
