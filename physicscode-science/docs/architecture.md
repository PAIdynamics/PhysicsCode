# Architecture

## Current PhysicsCode Shape

PhysicsCode is a Bun and TypeScript monorepo. The root package uses Bun
workspaces under `packages/*`, with the main CLI/runtime in `packages/physicscode`,
the web application in `packages/app`, reusable plugin APIs in `packages/plugin`,
SDKs under `sdks/` and `packages/sdk`, and docs under `packages/web`.

The repository already supports local extension through `.physicscode/`:

- `.physicscode/agent/*.md` defines specialized agents.
- `.physicscode/command/*.md` defines slash commands.
- `.physicscode/tool/*.ts` defines custom tools using `@physicscode-ai/plugin`.
- `.physicscode/physicscode.jsonc` controls providers, MCP servers, permissions,
  and tool enablement.
- `.physicscode/plugins/*.tsx` demonstrates plugin-based TUI extensions.

The cleanest integration point for scientific retrieval is therefore an external
service plus PhysicsCode command/agent/tool wrappers, not invasive changes to the
core TUI or session runtime.

## Science Retrieval Shape

`physicscode-science/` is a separate Python package for ingestion, storage,
retrieval, MCP serving, and evaluation. Phase 1 stores local development state in
SQLite while preserving the production boundary for PostgreSQL and Qdrant.

Phase 1 modules:

- `registry`: reads the versioned repository registry and resolves exact git
  revisions.
- `licensing`: detects repository-level and file-level licenses.
- `ingestion`: filters files, hashes content, invokes parsers, and writes reports.
- `parsers`: extracts first-pass semantic objects with stable provenance.
- `storage`: persists repository revisions and parsed objects.
- `storage.content_store`: stores source snapshots by content hash.
- `cli`: exposes deterministic ingestion jobs.

Future phases will add embeddings, hybrid search, MCP tools, scientific
enrichment, relationship expansion, reranking, and agentic validation.

Phase 2 now includes the first hybrid retrieval layer and an HTTP API boundary.
The API is intentionally small:

- `GET /health`
- `POST /v1/search`

The API returns the same provenance-bearing result shape as the CLI. MCP tools
in Phase 3 should wrap this service rather than reimplement retrieval logic.

## Integration Plan

1. Keep ingestion and retrieval independently testable in `physicscode-science/`.
2. Add a local MCP server in `physicscode-science/src/physicscode_science/mcp`.
3. Expose a small tool set: `science_search`, `science_get_source`,
   `science_get_context`, and license validation first.
4. Register the MCP server from `.physicscode/physicscode.jsonc` once the server
   is runnable.
5. Add `.physicscode/agent/science.md` and `.physicscode/command/science.md` as
   the PhysicsCode-facing workflow.
6. Keep implementation-authorized editing in the normal PhysicsCode agent loop,
   using retrieval results as evidence rather than generated patches.
