# Retrieval

Phase 2 implements an offline, deterministic hybrid retrieval MVP over the
SQLite development store. It provides:

- sparse BM25 search
- persisted vector-index search with deterministic hashed-vector fallback
- exact symbol search
- reciprocal-rank fusion
- repository, domain, language, object-type, and license filters
- CLI search
- HTTP API search through `POST /v1/search`
- retrieval-mode comparison through the evaluation harness
- generated scientific summary/query views from Phase 4
- relationship-aware context expansion from Phase 5
- deterministic reranking, deduplication, diversity selection, and context
  compression from Phase 6

The storage schema keeps the fields required by the future production retrieval
service:

- exact repository URL and commit
- path and line range
- symbol and object type
- language and license
- content hash and parser version
- raw content and structured metadata JSON
- source-file snapshot hash through the content-addressed store

The local hashed-vector channel is not a replacement for production embeddings,
but dense retrieval now has a real vector-index boundary. Local development uses
`.science/vector-index.json` when present; production deployments should use
Qdrant for nearest-neighbor search while SQLite remains the provenance and
metadata store.

Build the local development vector index after ingestion:

```sh
python -m physicscode_science.cli.main build-vector-index \
  --db .science/physicscode-science.sqlite \
  --backend local \
  --output .science/vector-index.json
```

Build or refresh a Qdrant production collection:

```sh
python -m physicscode_science.cli.main build-vector-index \
  --db .science/physicscode-science.sqlite \
  --backend qdrant \
  --qdrant-url http://127.0.0.1:6333 \
  --qdrant-collection physicscode_science_summary
```

At query time, set `PHYSICSCODE_SCIENCE_VECTOR_BACKEND=qdrant` and optionally
`PHYSICSCODE_SCIENCE_QDRANT_URL`,
`PHYSICSCODE_SCIENCE_QDRANT_COLLECTION`, and
`PHYSICSCODE_SCIENCE_QDRANT_API_KEY`. If Qdrant is unavailable, search falls
back to the local vector index when present and otherwise to deterministic dense
scoring.

Generated views are included in local sparse and hashed-vector retrieval. They
are clearly marked as deterministic generated metadata and should be retained
only while benchmark results show they improve retrieval quality.

`science_get_context` retrieves first and then expands selected results with
relationship graph neighbors. Expansion obeys a character budget and includes
relationship type, confidence, evidence, and exact source provenance for each
neighbor.

Search results include reranking explanations. Reranking can be disabled for
benchmark comparisons with `--no-rerank`, and deduplication/diversity selection
can be disabled independently.

Example search:

```sh
python -m physicscode_science.cli.main search \
  "matrix free Newton Krylov solver" \
  --db .science/physicscode-science.sqlite \
  --language cpp \
  --license BSD-3-Clause
```

Example API request:

```json
{
  "query": "Kokkos GPU charge deposition using atomics",
  "domains": ["particle-in-cell", "performance-portability"],
  "languages": ["cpp"],
  "licenses": ["Apache-2.0", "BSD-3-Clause"],
  "top_k": 10
}
```
