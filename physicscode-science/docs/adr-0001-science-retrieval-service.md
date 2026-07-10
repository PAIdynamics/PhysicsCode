# ADR 0001: Build Scientific Retrieval as a Separate Service

## Status

Accepted

## Context

PhysicsCode needs scientific software retrieval for source code, mathematical
documentation, build examples, tests, and provenance. The existing repository is
a Bun/TypeScript monorepo with local agent, command, tool, MCP, and plugin
extension points under `.physicscode/`.

The requested system needs deterministic ingestion, durable provenance, hybrid
retrieval, future MCP serving, and evaluation. Folding this directly into the
main runtime would make ingestion quality, retrieval evaluation, and production
storage harder to test independently.

## Decision

Create `physicscode-science/` as an independent service package. Phase 1 uses
Python standard-library components and SQLite for local state, with config and
interfaces shaped for the requested PostgreSQL and Qdrant production path.

PhysicsCode integration will happen through command, agent, and MCP boundaries:

- `.physicscode/command/science.md`
- `.physicscode/agent/science.md`
- future MCP server tools in `physicscode_science.mcp`

## Consequences

- The existing PhysicsCode implementation remains intact.
- Ingestion can be tested without running the TUI, web app, or model providers.
- Provenance and licensing are part of the storage model from the first phase.
- Phase 1 does not yet provide vector search or the final MCP server.
- SQLite is a local development stand-in, not the final production store.

## Phase Mapping

- Phase 1: implemented here as registry, revision pinning, license detection,
  file filtering, hashing, parsing, SQLite state, reports, and tests.
- Phase 2: add sparse/dense search, exact symbol search, filters, rank fusion,
  CLI/API search, and retrieval-mode evaluation against the stored objects.
- Phase 3: add MCP server and wire `/science` to the specialized agent.
- Phase 4+: add scientific enrichment, relationship expansion, reranking, and
  validation workflows.
