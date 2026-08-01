# PhysicsCode Science

PhysicsCode Science is the provenance-aware retrieval subsystem for scientific
software. It is intentionally separate from the main PhysicsCode runtime so
ingestion, retrieval, evaluation, and future MCP serving can be validated without
coupling them to one agent surface.

Phase 1 implements the ingestion foundation:

- versioned repository registry
- local clone discovery and exact commit pinning
- repository and file license detection
- deterministic file filtering
- content hashing
- basic semantic object extraction for source, documentation, and build files
- SQLite-backed local state and idempotent ingestion jobs
- JSON ingestion reports

Run the local test suite:

```sh
cd physicscode-science
PYTHONPATH=src python3 -m unittest discover -s tests/unit
```

Run a local ingestion report against the configured reference repositories:

```sh
cd physicscode-science
python -m physicscode_science.cli.main ingest --registry config/repositories.yaml --db .science/physicscode-science.sqlite --report .science/reports
```

The CLI also accepts explicit license policy and source snapshot locations:

```sh
python -m physicscode_science.cli.main ingest \
  --registry config/repositories.yaml \
  --licenses config/licenses.yaml \
  --db .science/physicscode-science.sqlite \
  --report .science/reports \
  --content-store .science/content
```

For a faster first population of search and vector retrieval, skip relationship
graph extraction and run it later:

```sh
python -m physicscode_science.cli.main ingest \
  --registry config/repositories.yaml \
  --licenses config/licenses.yaml \
  --taxonomy config/taxonomy.yaml \
  --db .science/physicscode-science.sqlite \
  --report .science/reports \
  --content-store .science/content \
  --skip-relationships \
  --stream-reports \
  --max-objects-per-repo 1000
```

Limit ingestion to selected repositories when growing the local index
incrementally:

```sh
python -m physicscode_science.cli.main ingest \
  --repository fftw3 \
  --repository lammps \
  --skip-relationships \
  --stream-reports \
  --max-objects-per-repo 50
```

Search the local index:

```sh
python -m physicscode_science.cli.main search \
  "Kokkos parallel_for execution policy" \
  --db .science/physicscode-science.sqlite \
  --language cpp \
  --top-k 10
```

Build the dense vector index used by the search channel:

```sh
python -m physicscode_science.cli.main build-vector-index \
  --db .science/physicscode-science.sqlite \
  --backend local \
  --output .science/vector-index.json
```

Report production readiness:

```sh
python -m physicscode_science.cli.main status \
  --db .science/physicscode-science.sqlite
```

Compare retrieval modes on a benchmark file:

```sh
python -m physicscode_science.cli.main evaluate \
  --db .science/physicscode-science.sqlite \
  --queries benchmarks/queries/phase2-smoke.json
```

Run an agentic scientific coding validation benchmark:

```sh
python -m physicscode_science.cli.main agentic-evaluate \
  --db .science/physicscode-science.sqlite \
  --tasks benchmarks/agentic/phase7-smoke.json \
  --output .science/agentic-reports
```

Regenerate and review scientific metadata:

```sh
python -m physicscode_science.cli.main enrich-metadata \
  --db .science/physicscode-science.sqlite \
  --taxonomy config/taxonomy.yaml

python -m physicscode_science.cli.main metadata-report \
  --db .science/physicscode-science.sqlite
```

Relationship-aware context is available through the MCP tool
`science_get_context`; it retrieves matching objects and expands selected graph
neighbors under a strict budget.

Reranking is enabled by default. Use `--no-rerank`, `--no-deduplicate`, or
`--no-diversity` on `search` for retrieval experiments.

Dense retrieval prefers a persisted vector index when `.science/vector-index.json`
exists. Production can use Qdrant by building the index with `--backend qdrant`
and setting `PHYSICSCODE_SCIENCE_VECTOR_BACKEND=qdrant`.
See `docs/production.md` for repository sync, Qdrant, embeddings, API, and MCP
readiness steps.

Agentic validation records a plan-before-edit workflow, retrieval evidence,
source/license provenance, compilation, tests, scientific validation, and a
no-retrieval baseline comparison.

Run the local HTTP API:

```sh
python -m physicscode_science.cli.main serve \
  --db .science/physicscode-science.sqlite \
  --host 127.0.0.1 \
  --port 8765
```

The same process exposes stateless Streamable HTTP MCP at `POST /mcp`. Protect
that endpoint at an internet-facing origin with either
`PHYSICSCODE_SCIENCE_API_KEY` or `PHYSICSCODE_SCIENCE_API_KEY_FILE`; clients
send the value as a Bearer token.

For local-only integrations, the separate MCP stdio transport remains
available:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main mcp \
  --db .science/physicscode-science.sqlite
```
