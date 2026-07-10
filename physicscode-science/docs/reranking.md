# Reranking

Phase 6 adds deterministic reranking and context optimization.

The local reranker is:

```txt
deterministic-reranker-v1
```

It combines fused retrieval score, symbol overlap, scientific metadata overlap,
path-term overlap, source-content overlap, retrieval-channel diversity, and an
exact-symbol bonus.

Each result includes `reason` and `explanation` fields so callers can see why it
was selected.

## Controls

Search reranking is enabled by default. Disable pieces from the CLI:

```sh
python -m physicscode_science.cli.main search "poisson solver" \
  --db .science/physicscode-science.sqlite \
  --no-rerank \
  --no-deduplicate \
  --no-diversity
```

The API and MCP tools accept equivalent booleans:

```json
{
  "query": "poisson solver",
  "rerank": true,
  "deduplicate": true,
  "diversity": true
}
```

## Evaluation

The evaluator compares `dense`, `sparse`, `symbol`, `hybrid_no_rerank`, and
`hybrid_rerank`. Use the delta between the hybrid modes to measure reranking.

## Context Compression

`science_get_context` reports `max_chars`, `used_chars`, `remaining_chars`, and
omitted result/neighbor counts. Related context is selected by relationship
priority and confidence, then compressed to compact summaries under the budget.
