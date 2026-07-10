# API

Phase 2 exposes a small HTTP API for retrieval experiments.

## Health

`GET /health`

```json
{ "status": "ok" }
```

## MCP

Phase 3 also exposes the same retrieval layer as an MCP stdio server:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main mcp \
  --db .science/physicscode-science.sqlite
```

Tools:

- `science_search`
- `science_get_source`
- `science_get_symbol`
- `science_get_context`
- `science_check_license`
- `science_project_context`

Agentic validation is exposed as a CLI benchmark harness rather than an HTTP or
MCP mutation endpoint. Implementation edits stay in the normal agent workflow;
the harness records evidence, validation loops, and baseline comparisons.

`science_get_context` accepts:

```json
{
  "query": "matrix-free Newton Krylov helper",
  "top_k": 5,
  "max_chars": 6000
}
```

It returns retrieved objects plus selected relationship neighbors under the
configured budget.

## Search

`POST /v1/search`

Request:

```json
{
  "query": "Kokkos parallel_for execution policy example",
  "repositories": ["kokkos"],
  "domains": ["performance-portability"],
  "languages": ["cpp"],
  "object_types": ["function", "example"],
  "licenses": ["Apache-2.0"],
  "retrieval_channels": ["dense", "sparse", "symbol"],
  "rerank": true,
  "deduplicate": true,
  "diversity": true,
  "top_k": 10,
  "include_content": false
}
```

Response:

```json
{
  "results": [
    {
      "result_id": "sha256:...",
      "repository": "kokkos",
      "repository_url": "https://github.com/kokkos/kokkos",
      "commit": "...",
      "path": "...",
      "start_line": 1,
      "end_line": 10,
      "symbol": "...",
      "object_type": "function",
      "language": "cpp",
      "license": "Apache-2.0",
      "score": 0.031,
      "retrieval_channels": ["sparse", "symbol"],
      "reason": "Matched by sparse, symbol retrieval",
      "summary": "..."
    }
  ]
}
```
