# PhysicsCode Science Agent Notes

- Keep ingestion deterministic: no network updates or model calls unless a user
  explicitly enables them through configuration.
- Preserve exact source provenance on every stored object.
- Treat repositories with unclear licensing as disabled or reference-only by
  default.
- Use stdlib implementations for Phase 1 unless a dependency materially improves
  parsing or retrieval quality.
- Do not couple ingestion to the PhysicsCode TUI, web app, or one model provider.
- For agentic validation tasks, record the plan before edits, keep scientific
  validation separate from compilation/tests, and preserve failures as report
  data instead of hiding them.
