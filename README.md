<p align="center">
  <img src="packages/identity/logo-circular.png" alt="physicscode logo" width="120">
</p>

# physicscode

physicscode is a closed-source agentic AI coding environment for
physics-focused software, simulations, analysis, and research engineering.

## Install

Install dependencies from the repository root:

```bash
bun install
```

Run the CLI/TUI locally:

```bash
bun run dev
```

Run the desktop app locally:

```bash
bun run dev:desktop
```

Build the downloadable desktop app:

```bash
cd packages/desktop-electron
bun run package:mac
```

Packaged desktop artifacts are written to `packages/desktop-electron/dist/`.
On macOS, open the unpacked app directly from
`packages/desktop-electron/dist/mac-arm64/PhysicsCode Dev.app` or install from
the generated `physicscode-electron-mac-arm64.dmg`. The `.zip` in the same
directory is the update/download archive.

Build the CLI executable:

```bash
cd packages/physicscode
bun run build
```

The build outputs platform-specific executables under
`packages/physicscode/dist/`. Those binaries are the artifacts to publish for
users who want to download and run physicscode directly.

## License

Original physicscode materials are proprietary and governed by the root
[`LICENSE`](./LICENSE).

physicscode is derived from OpenCode. The original OpenCode MIT notice and other
third-party notices are preserved in [`Licenses`](./Licenses).
