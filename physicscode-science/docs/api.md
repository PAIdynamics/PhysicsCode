# API

Phase 2 exposes a small HTTP API for retrieval experiments.

## Health

`GET /health`

```json
{ "status": "ok" }
```

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
