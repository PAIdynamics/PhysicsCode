# physicscode

physicscode is a closed-source agentic AI development product built from the
OpenCode codebase. It adapts OpenCode's agent workflow for physics-focused code,
simulation, analysis, and research engineering work.

## Status

This repository is an early product fork. Expect names, package metadata,
distribution channels, and product documentation to change as physicscode takes
shape.

## License

Original physicscode materials are proprietary and governed by the root
[`LICENSE`](./LICENSE).

This product includes OpenCode-derived code and other third-party materials.
Their notices are preserved in [`Licenses`](./Licenses), including the original
OpenCode MIT License notice. Third-party software remains governed by its
applicable third-party license terms.

## Development

The codebase currently keeps much of the original OpenCode workspace structure.
Use Bun for package scripts and run checks from package directories rather than
from the repository root.

```bash
bun install
cd packages/opencode
bun typecheck
```

## Attribution

physicscode is derived from OpenCode. OpenCode is licensed under the MIT License;
see [`Licenses/OPENCODE-MIT-LICENSE`](./Licenses/OPENCODE-MIT-LICENSE).
