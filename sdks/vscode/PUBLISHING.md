# Publishing PhysicsCode for VS Code

The extension id is:

```text
paidynamicsch.physicscode
```

If you use a different Visual Studio Marketplace publisher id, update
`publisher` in `package.json` before packaging.

## Prerequisites

- A Visual Studio Marketplace publisher whose id matches `package.json`.
- An Azure DevOps Personal Access Token with Marketplace manage permission.
- Optional: an Open VSX access token and namespace matching the same publisher id.
- The PhysicsCode CLI must be installable by users as `physicscode`, or users must
  set `physicscode.cliPath` in VS Code.

## Package Locally

```bash
cd sdks/vscode
bun install
bun run package
bunx @vscode/vsce package --no-dependencies -o dist/physicscode.vsix
```

Install the VSIX locally:

```bash
code --install-extension dist/physicscode.vsix --force
```

## Publish

Login once:

```bash
bunx @vscode/vsce login paidynamicsch
```

Then publish:

```bash
./script/publish
```

For CI or non-interactive publishing:

```bash
VSCE_PAT="..." OPENVSX_TOKEN="..." ./script/publish
```

The Marketplace listing becomes searchable in VS Code as `PhysicsCode` after the
Marketplace finishes indexing it.
