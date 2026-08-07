<p align="center">
  <img src="packages/identity/logo-circular.png" alt="physicscode logo" width="120">
</p>

# physicscode

physicscode is a source-available agentic AI coding environment for
physics-focused software, simulations, analysis, and research engineering. It's
built on [OpenCode](https://github.com/anomalyco/opencode).

## Install

Install dependencies from the repository root:

```bash
bun install
```

Run the CLI/TUI locally:

```bash
bun run dev
```

Run the desktop app locally (Tauri, the primary desktop shell):

```bash
bun run dev:desktop
```

This requires the Rust toolchain and platform Tauri prerequisites — see
[packages/desktop/README.md](packages/desktop/README.md) and the
[Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

Build the downloadable desktop app:

```bash
cd packages/desktop
bun run tauri build
```

Packaged desktop artifacts are written under
`packages/desktop/src-tauri/target/release/bundle/` (per-platform
subdirectories, e.g. `dmg/`, `deb/`, `rpm/`, `nsis/`).

An Electron build of the same UI also exists in `packages/desktop-electron`
(`bun run dev:desktop:electron`) but is being phased out in favor of Tauri —
see that package's README for status.

Build the CLI executable:

```bash
cd packages/physicscode
bun run build
```

The build outputs platform-specific executables under
`packages/physicscode/dist/`. Those binaries are the artifacts to publish for
users who want to download and run physicscode directly.

## Connect a Model Provider

physicscode doesn't ship with any API keys — you connect your own. It supports
75+ providers (Anthropic, OpenAI, Google, Azure, Bedrock, local models, and
more) via [Models.dev](https://models.dev).

**Interactive (recommended):** run physicscode, then inside the TUI run:

```
/connect
```

Pick a provider and paste your API key. It's written to
`~/.local/share/physicscode/auth.json` on your machine — this file is never
part of the repo and should never be committed anywhere.

**Environment variables:** each provider also reads its standard env var, e.g.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

**Config file:** provider behavior (base URL, proxies, model allowlists) can
be set in `physicscode.json` — but never put a live API key in this file:

```json
{
  "$schema": "https://physicscode.ai/config.json",
  "provider": {
    "anthropic": {
      "options": { "baseURL": "https://api.anthropic.com/v1" }
    }
  }
}
```

Full reference: [physicscode.ai/docs/providers](https://physicscode.ai/docs/providers).

## VS Code Extension

The VS Code extension lives in `sdks/vscode`. Before publishing a new extension
build, bump the `version` field in `sdks/vscode/package.json`; the Visual Studio
Marketplace rejects uploads that reuse an existing version.

Build the VSIX:

```bash
cd sdks/vscode
bunx @vscode/vsce package --no-dependencies -o dist/physicscode.vsix
```

Publish to the Visual Studio Marketplace:

```bash
bunx @vscode/vsce publish --packagePath dist/physicscode.vsix
```

The extension publisher id is `paidynamicsch`, so the Marketplace extension id
is `paidynamicsch.physicscode`. If publishing from a new machine, first run
`bunx @vscode/vsce login paidynamicsch` and provide a Personal Access Token with
`Marketplace > Manage` permission.

## License

Original physicscode materials are proprietary and governed by the root
[`LICENSE`](./LICENSE).

PhysicsCode is derived from OpenCode. The original OpenCode MIT notice and other
third-party notices are preserved in [`Licenses`](./Licenses).
