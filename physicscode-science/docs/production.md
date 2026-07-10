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

Run the MCP/API process with:

```sh
PHYSICSCODE_SCIENCE_VECTOR_BACKEND=qdrant
PHYSICSCODE_SCIENCE_QDRANT_URL=http://127.0.0.1:6333
PHYSICSCODE_SCIENCE_QDRANT_COLLECTION=physicscode_science_summary
```

## Embeddings

The vector builder supports OpenAI-compatible embedding servers, including vLLM
when an embedding model is served:

```sh
python -m physicscode_science.cli.main build-vector-index \
  --db .science/physicscode-science.sqlite \
  --backend qdrant \
  --embedding-provider vllm \
  --embedding-url http://127.0.0.1:8000 \
  --embedding-model your-embedding-model
```

The local `gpt-oss-120b` vLLM server currently lists chat/generation models but
does not expose `/v1/embeddings`. Until an embedding model is served, the index
falls back to deterministic hashed vectors.

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

