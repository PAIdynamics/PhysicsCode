# Evaluation

Phase 2 includes a deterministic retrieval evaluator. It compares:

- dense only
- sparse only
- symbol only
- hybrid dense+sparse+symbol without reranking
- hybrid dense+sparse+symbol with reranking

Metrics currently reported:

- recall at 5
- recall at 10
- mean reciprocal rank
- nDCG at 10

Run:

```sh
python -m physicscode_science.cli.main evaluate \
  --db .science/physicscode-science.sqlite \
  --queries benchmarks/queries/phase2-smoke.json \
  --top-k 10
```

The full benchmark set is still future work. It should contain at least 100
scientific software questions covering exact API lookup, symbol search,
numerical methods, equation-to-code retrieval, build troubleshooting,
accelerator debugging, Kokkos patterns, solver selection, boundary conditions,
tests, examples, and license-constrained retrieval.

Phase 4 generated views should be evaluated against this benchmark before they
are expanded or replaced with model-generated summaries.

Phase 6 reranking should be evaluated by comparing `hybrid_no_rerank` and
`hybrid_rerank`, including latency and result diversity once production
instrumentation is added.

Phase 7 adds end-to-end agentic validation with `agentic-evaluate`. These
reports are separate from retrieval metrics: they record plan-before-edit state,
selected evidence, source/license provenance, compilation, tests, scientific
validation, and a no-retrieval baseline for the same task definition.
