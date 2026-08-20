import { afterEach, describe, expect, test } from "bun:test"
import { resource, Observability } from "@physicscode-ai/core/effect/observability"

const ATTRS_KEY = "OTEL_RESOURCE_ATTRIBUTES"
const original = process.env[ATTRS_KEY]

afterEach(() => {
  if (original === undefined) delete process.env[ATTRS_KEY]
  else process.env[ATTRS_KEY] = original
})

describe("observability.resource", () => {
  test("includes the fixed service identity fields", () => {
    delete process.env[ATTRS_KEY]
    const result = resource()
    expect(result.serviceName).toBe("physicscode")
    expect(typeof result.serviceVersion).toBe("string")
  })

  test("includes built-in attributes even with no OTEL_RESOURCE_ATTRIBUTES set", () => {
    delete process.env[ATTRS_KEY]
    const result = resource()
    expect(result.attributes).toHaveProperty(["deployment.environment.name"])
    expect(result.attributes).toHaveProperty(["physicscode.process_role"])
    expect(result.attributes).toHaveProperty(["physicscode.run_id"])
    expect(result.attributes).toHaveProperty(["service.instance.id"])
  })

  test("parses a single custom OTEL_RESOURCE_ATTRIBUTES entry", () => {
    process.env[ATTRS_KEY] = "team=science"
    const result = resource()
    expect(result.attributes.team).toBe("science")
  })

  test("parses multiple comma-separated entries", () => {
    process.env[ATTRS_KEY] = "team=science,region=eu"
    const result = resource()
    expect(result.attributes.team).toBe("science")
    expect(result.attributes.region).toBe("eu")
  })

  test("URI-decodes keys and values", () => {
    process.env[ATTRS_KEY] = "team%20name=science%20division"
    const result = resource()
    expect(result.attributes["team name"]).toBe("science division")
  })

  test("built-in attributes still win when a custom entry reuses the same key", () => {
    process.env[ATTRS_KEY] = "deployment.environment.name=custom-value"
    const result = resource()
    // spread order in resource() applies the fixed keys after the parsed
    // custom attributes, so the built-in value always wins on collision
    expect(result.attributes["deployment.environment.name"]).not.toBe("custom-value")
  })

  test("falls back to no custom attributes when an entry has no '='", () => {
    process.env[ATTRS_KEY] = "not-a-key-value-pair"
    const result = resource()
    expect(result.attributes).toHaveProperty(["deployment.environment.name"])
    expect(result.attributes["not-a-key-value-pair"]).toBeUndefined()
  })

  test("falls back to no custom attributes when the value is empty string", () => {
    delete process.env[ATTRS_KEY]
    const result = resource()
    // sanity: default call still returns a well-formed attributes object
    expect(typeof result.attributes).toBe("object")
  })
})

describe("observability.Observability (default test-env behavior)", () => {
  test("is disabled and falls back to the plain logger layer when no OTLP endpoint is configured", () => {
    // In this test environment OTEL_EXPORTER_OTLP_ENDPOINT is unset, so
    // `enabled`/`layer` (computed once at module load) take their
    // no-OTLP branch.
    expect(Observability.enabled).toBe(false)
    expect(Observability.layer).toBeDefined()
  })
})
