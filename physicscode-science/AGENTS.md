# PhysicsCode Science Agent Notes

- Keep ingestion deterministic: no network updates or model calls unless a user
  explicitly enables them through configuration.
- Preserve exact source provenance on every stored object.
- Treat repositories with unclear licensing as disabled or reference-only by
  default.
- Use stdlib implementations for Phase 1 unless a dependency materially improves
  parsing or retrieval quality.
- Do not couple ingestion to the PhysicsCode TUI, web app, or one model provider.
