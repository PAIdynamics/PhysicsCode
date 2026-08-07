# PhysicsCode Desktop (Electron)

Native PhysicsCode desktop app, built with Electron.

> **Status:** this is the legacy desktop shell. The primary desktop shell is
> now [packages/desktop](../desktop) (Tauri) — smaller installers, a fully
> permissive dependency stack, and the same shared UI from
> [packages/app](../app). This Electron build is kept around while the Tauri
> build is validated end-to-end, and will be removed once that's confirmed.

## Development

From the repo root:

```bash
bun install
bun run dev:desktop:electron
```

## Build

```bash
bun run --cwd packages/desktop-electron package:mac   # or package:win / package:linux
```

Packaged artifacts are written to `packages/desktop-electron/dist/`.
