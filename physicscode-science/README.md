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

Search the local index:

```sh
python -m physicscode_science.cli.main search \
  "Kokkos parallel_for execution policy" \
  --db .science/physicscode-science.sqlite \
  --language cpp \
  --top-k 10
```

Compare retrieval modes on a benchmark file:

```sh
python -m physicscode_science.cli.main evaluate \
  --db .science/physicscode-science.sqlite \
  --queries benchmarks/queries/phase2-smoke.json
```

Run the local HTTP API:

```sh
python -m physicscode_science.cli.main serve \
  --db .science/physicscode-science.sqlite \
  --host 127.0.0.1 \
  --port 8765
```

Run the MCP stdio server for PhysicsCode or other MCP clients:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main mcp \
  --db .science/physicscode-science.sqlite
```
