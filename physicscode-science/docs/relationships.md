# Relationships

Phase 5 adds relationship-aware retrieval. Relationships are stored relationally
in `source_relationship`; no dedicated graph database is required for the MVP.

Current relationship types:

- `file-defines-symbol`
- `symbol-calls-symbol`
- `file-includes-file`
- `documentation-describes-symbol`
- `test-exercises-symbol`
- `example-uses-symbol`

Each edge records:

- source object id
- target object id
- relationship type
- confidence
- evidence
- extractor version

The first extractor is deterministic:

```txt
relationship-keyword-v1
```

## Context Expansion

`science_get_context` performs retrieval first, then expands each selected result
with a small number of high-value graph neighbors. Expansion is ordered by
relationship priority and confidence, and it stops at the configured character
budget.

Priority order:

1. called symbols
2. tests
3. examples
4. documentation
5. defining files
6. includes/imports

The expansion intentionally avoids returning every neighbor. Irrelevant neighbor
expansion should be measured through the retrieval evaluation suite before new
relationship types are added.

## Limitations

The Phase 5 extractor is conservative and regex-based. It is meant to establish
the storage and retrieval contract. Later parser work should replace or augment
it with tree-sitter, clang tooling, Python AST analysis, and Fortran-specific
parsers.
