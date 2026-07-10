# Evaluation

Phase 2 includes a deterministic retrieval evaluator. It compares:

- dense only
- sparse only
- symbol only
- hybrid dense+sparse+symbol

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
