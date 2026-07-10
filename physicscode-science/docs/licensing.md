# Licensing

Phase 1 detects repository-level license files and file-level headers using
conservative patterns. Objects retain the detected SPDX-like license identifier,
license source, and copyright notices when available.

Repositories or files with unclear licensing are marked `NOASSERTION`. Future
retrieval filters should exclude those by default unless the user explicitly
requests reference-only context.

`config/licenses.yaml` controls Phase 1 ingestion behavior. The default policy
allows common permissive scientific-software licenses, marks strong copyleft
licenses as reference-only, and excludes `NOASSERTION` sources by default.
