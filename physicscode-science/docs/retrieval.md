# Retrieval

Phase 2 implements an offline, deterministic hybrid retrieval MVP over the
SQLite development store. It provides:

- sparse BM25 search
- deterministic hashed-vector search as a local dense-search stand-in
- exact symbol search
- reciprocal-rank fusion
- repository, domain, language, object-type, and license filters
- CLI search
- HTTP API search through `POST /v1/search`
- retrieval-mode comparison through the evaluation harness

The storage schema keeps the fields required by the future production retrieval
service:

- exact repository URL and commit
- path and line range
- symbol and object type
- language and license
- content hash and parser version
- raw content and structured metadata JSON
- source-file snapshot hash through the content-addressed store

The local hashed-vector channel is not a replacement for production embeddings.
It is a deterministic acceptance-test scaffold that preserves the dense-channel
interface until Qdrant and configured embedding providers are enabled.

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
