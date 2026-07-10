# Production Operations

Production science retrieval should run as a repeatable indexing and serving
pipeline:

1. Sync reference repositories.
2. Ingest changed repositories.
3. Build or refresh the vector index.
4. Serve the HTTP API and MCP server.
5. Check readiness before using `/science`.

## Repository Sync

Report local clone state:

```sh
python -m physicscode_science.cli.main sync-repositories \
  --registry config/repositories.yaml
```

Fetch remotes when network access is allowed:

```sh
python -m physicscode_science.cli.main sync-repositories \
  --registry config/repositories.yaml \
  --fetch
```

Clone missing repositories explicitly:

```sh
python -m physicscode_science.cli.main sync-repositories \
  --registry config/repositories.yaml \
  --clone-missing
```

## Qdrant

Start Qdrant from the included compose file:

```sh
docker compose up -d qdrant
```

Build the production vector collection:

```sh
python -m physicscode_science.cli.main build-vector-index \
  --db .science/physicscode-science.sqlite \
  --backend qdrant \
  --qdrant-url http://127.0.0.1:6333 \
  --qdrant-collection physicscode_science_summary
```

For higher-quality production retrieval, prefer the multi-vector collection.
This stores separate embeddings for summary/metadata, symbol signature, raw
source, and documentation/query views under the same Qdrant point:

```sh
KEY="$(cat ~/.config/vllm/client_api_key)"

PYTHONPATH=src python3 -m physicscode_science.cli.main build-vector-index \
  --db .science/physicscode-science.sqlite \
  --backend qdrant \
  --qdrant-url http://127.0.0.1:6333 \
  --qdrant-collection physicscode_science_multiview_bge_m3 \
  --qdrant-vector-mode multi \
  --embedding-provider vllm \
  --embedding-url http://127.0.0.1:8000 \
  --embedding-model paidynamics/bge-m3-pai \
  --embedding-api-key "$KEY" \
  --embedding-max-chars 4000
```

Run the MCP/API process with:

```sh
PHYSICSCODE_SCIENCE_VECTOR_BACKEND=qdrant
PHYSICSCODE_SCIENCE_QDRANT_URL=http://127.0.0.1:6333
PHYSICSCODE_SCIENCE_QDRANT_COLLECTION=physicscode_science_multiview_bge_m3
PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER=vllm
PHYSICSCODE_SCIENCE_EMBEDDING_URL=http://127.0.0.1:8000
PHYSICSCODE_SCIENCE_EMBEDDING_MODEL=paidynamics/bge-m3-pai
PHYSICSCODE_SCIENCE_EMBEDDING_API_KEY=<server key>
```

## Embeddings

The vector builder supports OpenAI-compatible embedding servers, including vLLM
when an embedding model is served:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main build-vector-index \
  --db .science/physicscode-science.sqlite \
  --backend qdrant \
  --qdrant-collection physicscode_science_bge_m3 \
  --embedding-provider vllm \
  --embedding-url http://127.0.0.1:8000 \
  --embedding-model paidynamics/bge-m3-pai \
  --embedding-api-key "$(cat ~/.config/vllm/client_api_key)"
```

The local vLLM proxy exposes `/v1/embeddings` through
`paidynamics/bge-m3-pai`, backed by `BAAI/bge-m3`, for the preferred production
collection. `paidynamics/bge-large-en-v1.5-pai` remains available as a proven
1024-dimensional fallback, and `paidynamics/bge-small-en-v1.5-pai` is available
as a lightweight 384-dimensional fallback.

`PHYSICSCODE_SCIENCE_EMBEDDING_MAX_CHARS` defaults to `4000`. Increase it for
large code objects if embedding latency is acceptable; decrease it for faster
refreshes.

## Retrieval Evaluation

Run the production seed benchmark after each ingestion/indexing change:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main evaluate \
  --db .science/physicscode-science.sqlite \
  --queries benchmarks/queries/production-seed.json \
  --top-k 10
```

The report compares dense, sparse, symbol, hybrid, and reranked hybrid modes and
includes recall, MRR, nDCG, latency, top results, and queries with missing
relevance. Treat this as a smoke benchmark; add exact relevant symbols/object IDs
for high-confidence regression tracking as production questions accumulate.

## Readiness

Check status locally:

```sh
python -m physicscode_science.cli.main status \
  --db .science/physicscode-science.sqlite
```

HTTP readiness endpoints:

- `GET /health`
- `GET /ready`
- `GET /v1/status`

MCP exposes the same information through `science_status`.
