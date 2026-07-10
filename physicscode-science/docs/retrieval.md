# Retrieval

Retrieval is intentionally not implemented in Phase 1. The storage schema keeps
the fields required by the future hybrid retrieval service:

- exact repository URL and commit
- path and line range
- symbol and object type
- language and license
- content hash and parser version
- raw content and structured metadata JSON
- source-file snapshot hash through the content-addressed store

Phase 2 will add sparse search, dense vector indexing, exact symbol lookup,
metadata filters, and rank fusion.
