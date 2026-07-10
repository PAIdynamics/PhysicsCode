# PhysicsCode Integration

The `/science` flow should remain evidence-first:

1. Inspect the user's project without modifying files.
2. Interpret the scientific request.
3. Build multiple retrieval queries.
4. Retrieve source-backed evidence from the science service.
5. Rerank and filter by compatibility and license.
6. Present an implementation and validation plan.
7. Modify code only when authorized.
8. Compile, test, and report provenance.

The initial command and agent documents are placeholders until Phase 3 exposes
the MCP-compatible service.

## Phase 3 Status

Phase 3 exposes `physicscode-science` through:

- MCP stdio server: `python3 -m physicscode_science.cli.main mcp`
- local PhysicsCode MCP config under `.physicscode/physicscode.jsonc`
- project-local custom tools:
  - `.physicscode/tool/science-search.ts`
  - `.physicscode/tool/science-source.ts`
- `/science` command and `science` agent guidance

Before using `/science` retrieval in a live session, build the local science
index:

```sh
cd physicscode-science
PYTHONPATH=src python3 -m physicscode_science.cli.main ingest \
  --registry config/repositories.yaml \
  --licenses config/licenses.yaml \
  --db .science/physicscode-science.sqlite \
  --report .science/reports \
  --content-store .science/content
```

The MCP server is configured to read:

```txt
/home/mohsen/github/code/physicscode-science/.science/physicscode-science.sqlite
```

If that database does not exist yet, the tools will connect but return no
retrieval results.
