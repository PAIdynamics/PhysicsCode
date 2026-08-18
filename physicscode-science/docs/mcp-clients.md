# Using the science MCP from Codex or Claude Code

`physicscode-science` speaks standard MCP (newline-delimited JSON-RPC over
stdio, and Streamable HTTP over `POST /mcp`), so it isn't limited to the
`physicscode` CLI. Any MCP-capable client can use it, including Claude Code
and Codex. Three ways to wire it up, in order of how much setup they need.

All examples below were verified against a real local index and the actual
`claude mcp add` / `codex mcp add` commands (Claude Code 2.1.x, Codex CLI
0.147.x) — flags can drift between releases, so if a command below doesn't
match your installed version, check `claude mcp add --help` /
`codex mcp add --help`.

## Option A — Local stdio, served from this machine

No install, no network dependency beyond the index itself. Build or point at
a `.science` database first (see the main
[README](../README.md#run-a-local-ingestion-report-against-the-configured-reference-repositories)
for `ingest`), then register the server by invoking the module directly with
`PYTHONPATH` set — **not** the `physicscode-science` console-script entry
point installed by `pip install -e .`, which some MCP clients fail to spawn
correctly (they don't inherit enough of the environment for Python to find
the editable install). The module invocation below has no such dependency.

Claude Code:

```sh
claude mcp add physicscode-science-local \
  -e PYTHONPATH=/path/to/physicscode-science/src \
  -- python3 -m physicscode_science.cli.main mcp --db /path/to/.science/physicscode-science.sqlite
```

Codex:

```sh
codex mcp add physicscode-science-local \
  --env PYTHONPATH=/path/to/physicscode-science/src \
  -- python3 -m physicscode_science.cli.main mcp --db /path/to/.science/physicscode-science.sqlite
```

Confirm Claude Code actually connected (Codex's `mcp get`/`mcp list` show
config, not live status):

```sh
claude mcp list
# physicscode-science-local: ... - ✔ Connected
```

## Option B — Local Streamable HTTP, served from this machine

Useful if you want one long-running server shared by several clients/sessions
instead of a process per client. Start it once:

```sh
PYTHONPATH=src python3 -m physicscode_science.cli.main serve \
  --db .science/physicscode-science.sqlite --host 127.0.0.1 --port 8765
```

It exposes `POST /mcp` alongside the retrieval HTTP API, protected by
`PHYSICSCODE_SCIENCE_API_KEY` or `PHYSICSCODE_SCIENCE_API_KEY_FILE` (see
[production.md](production.md)) — clients send that value as a bearer token.

Claude Code:

```sh
claude mcp add --transport http physicscode-science http://127.0.0.1:8765/mcp \
  --header "Authorization: Bearer $(cat ~/.config/vllm/client_api_key)"
```

Codex (reads the token from an env var rather than taking it as a literal,
so the key doesn't end up in `~/.codex/config.toml`):

```sh
export PHYSICSCODE_SCIENCE_TOKEN=$(cat ~/.config/vllm/client_api_key)
codex mcp add physicscode-science \
  --url http://127.0.0.1:8765/mcp \
  --bearer-token-env-var PHYSICSCODE_SCIENCE_TOKEN
```

Codex's HTTP/Streamable MCP support depends on your installed version; if
`--url` isn't recognized, fall back to Option A.

## Option C — Hosted, via your PhysicsCode account (works from any machine)

No local index or server to run, and no dependency on this machine
specifically — this is the option to use on a laptop, a CI runner, or any
other machine that isn't running its own science index.
`https://www.physicscode.ai/mcp` proxies to the production science origin,
authenticated with a PhysicsCode API key (generate one at
`https://www.physicscode.ai/account` → Profile → **Generate new key**; email
verification is required) or the bearer token `physicscode account login`
stores — see the main [physicscode-integration.md](physicscode-integration.md)
doc for how the `physicscode` CLI itself receives this via account config.
The same key works across as many machines as you want.

Claude Code:

```sh
claude mcp add --transport http physicscode-science https://www.physicscode.ai/mcp \
  --header "Authorization: Bearer <your PhysicsCode account token or API key>"
```

Codex:

```sh
export PHYSICSCODE_TOKEN=<your PhysicsCode account token or API key>
codex mcp add physicscode-science \
  --url https://www.physicscode.ai/mcp \
  --bearer-token-env-var PHYSICSCODE_TOKEN
```

### Using Codex from VS Code

The Codex VS Code extension bundles the same `codex` CLI and reads the same
`~/.codex/config.toml` (same `CODEX_HOME` resolution) — anything registered
with `codex mcp add` in a terminal is picked up automatically, no separate
setup in VS Code. The one gotcha: `--bearer-token-env-var` only stores the
variable *name*; the value must be present in the environment VS Code itself
launches with, not just your terminal at registration time. Add the `export`
line to your shell profile (`~/.bashrc`/`~/.zshrc`) and fully restart VS Code
(env vars set after it's already running don't apply retroactively).

## Tools exposed

Same tool set regardless of transport: `science_search`, `science_get_source`,
`science_get_symbol`, `science_get_context`, `science_check_license`,
`science_project_context`, `science_status`. See the recommended call order
in [physicscode-integration.md](physicscode-integration.md).
