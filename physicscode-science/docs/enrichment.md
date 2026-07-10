# Enrichment

Phase 4 adds deterministic scientific metadata enrichment. The enrichment layer
uses `config/taxonomy.yaml` as the controlled vocabulary and records extraction
provenance on each indexed object.

Current generated metadata:

- domains
- algorithms
- equations
- parallel models
- hardware backends
- numerical properties
- generated summaries
- generated representative queries

Each tag includes:

- controlled value
- confidence
- matched terms
- extraction source/version

The default extractor is deterministic and does not call a language model:

```txt
scientific-keyword-v1
```

Generated retrieval views use:

```txt
deterministic-template-v1
```

## Ingestion

Metadata is generated during ingestion when a taxonomy is supplied:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main ingest \
  --registry config/repositories.yaml \
  --licenses config/licenses.yaml \
  --taxonomy config/taxonomy.yaml \
  --db .science/physicscode-science.sqlite \
  --report .science/reports \
  --content-store .science/content
```

## Regeneration

Metadata can be regenerated from stored parsed objects without recloning
repositories:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main enrich-metadata \
  --db .science/physicscode-science.sqlite \
  --taxonomy config/taxonomy.yaml
```

## Review

Generate a metadata coverage and low-confidence report:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main metadata-report \
  --db .science/physicscode-science.sqlite
```

Low-confidence metadata should be treated as a retrieval hint, not as verified
scientific fact.
