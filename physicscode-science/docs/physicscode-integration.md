# PhysicsCode Integration

## Science modes in the CLI

The CLI has three science retrieval modes. Each one is a primary agent, so the
mode is sticky for the session and shows in the prompt footer:

| Mode | Agent | How to enable | Behaviour |
| --- | --- | --- | --- |
| Hybrid (default) | `hybrid` | default, or `/hybrid` | The agent decides per prompt whether to use science retrieval. |
| Science | `science` | `/science` (optionally followed by a prompt) | Every prompt goes through the science index: the CLI runs `science_search` on the prompt before the model call and attaches the evidence to the message (see `packages/physicscode/src/session/science.ts`). The model may search further. |
| Science off | `science-off` | `/science-off` (optionally followed by a prompt) | Prompts never go through the science index; the `science_*` MCP tools and local `science-*` tools are denied. |

`/hybrid`, `/science` and `/science-off` with no arguments only switch the
mode. With arguments they switch the mode and send the arguments as the first
prompt in that mode. The session stays in the chosen mode until the user
switches again.

The `/science` flow should remain evidence-first:

1. Inspect the user's project without modifying files.
2. Interpret the scientific request.
3. Build multiple retrieval queries.
4. Retrieve source-backed evidence from the science service.
5. Rerank and filter by compatibility and license.
6. Present an implementation and validation plan.
7. Modify code only when authorized.
8. Compile, test, and report provenance.

## Phase 3 Status

Phase 3 exposes `physicscode-science` through:

- authenticated Streamable HTTP MCP at `https://www.physicscode.ai/mcp`
- MCP stdio server: `python3 -m physicscode_science.cli.main mcp`
- authenticated account config returned by `physicscode.ai`
- project-local custom tools:
  - `.physicscode/tool/science-search.ts`
  - `.physicscode/tool/science-source.ts`
- `/science` command and `science` agent guidance
- `science_project_context` MCP tool for read-only project inspection

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

The hosted MCP server reads:

```txt
/home/mohsen/github/code/physicscode-science/.science/physicscode-science.sqlite
```

Logged-in PhysicsCode clients receive the remote MCP URL and their Bearer header
through account config, so the same tools work on Linux, macOS, and Windows.

Recommended `/science` order:

1. Call `science_project_context` for the current repository.
2. Interpret the scientific problem and missing assumptions.
3. Run several `science_search` queries with domain, language, library, license,
   and hardware filters where possible.
4. Fetch exact source records with `science_get_source`.
5. Present an evidence-backed plan before editing.
