# Ingestion

The Phase 1 ingestion CLI reads `config/repositories.yaml`, resolves each local
git clone to an exact commit, detects licensing, filters indexable files, parses
semantic objects, and writes a JSON report per repository.

```sh
python -m physicscode_science.cli.main ingest \
  --registry config/repositories.yaml \
  --licenses config/licenses.yaml \
  --db .science/physicscode-science.sqlite \
  --report .science/reports \
  --content-store .science/content
```

Use `--max-files-per-repo` for smoke tests against large local clones.

Parser failures are captured in the report instead of being swallowed. Unchanged
objects are idempotent: reingesting the same revision does not create duplicate
records.

Each ingested source file is also written to a content-addressed local store by
SHA-256 hash. The SQLite development store records both file-level state and
semantic object state, which lets ingestion distinguish unchanged files, changed
files, changed objects, deleted stale objects, and license-policy skips.

Phase 1 acceptance coverage:

- exact repository commit is resolved from each local clone
- repository revision state is stored
- repository and file licenses are detected
- configured license policy can exclude unknown or incompatible sources
- source files are content-addressed by SHA-256
- semantic objects retain repository, URL, commit, path, line range, symbol,
  language, license, content hash, parser version, and ingestion timestamp
- unchanged reingestion is idempotent
- changed files update only changed object rows where object identity is stable
