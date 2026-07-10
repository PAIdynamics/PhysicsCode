# Ingestion

The Phase 1 ingestion CLI reads `config/repositories.yaml`, resolves each local
git clone to an exact commit, detects licensing, filters indexable files, parses
semantic objects, and writes a JSON report per repository.

```sh
python -m physicscode_science.cli.main ingest \
  --registry config/repositories.yaml \
  --db .science/physicscode-science.sqlite \
  --report .science/reports
```

Use `--max-files-per-repo` for smoke tests against large local clones.

Parser failures are captured in the report instead of being swallowed. Unchanged
objects are idempotent: reingesting the same revision does not create duplicate
records.
