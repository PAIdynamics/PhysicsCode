from __future__ import annotations

import json
import sys
from typing import Any, BinaryIO

from physicscode_science.mcp.tools import UnknownToolError, call_tool, tool_definitions

# Newest first. A client asking for one of these gets it back; anything else
# gets the newest, and the client decides whether it can continue.
SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]
SERVER_VERSION = "0.2.0"

INSTRUCTIONS = """PhysicsCode indexes open-source scientific and HPC codebases (solvers, \
discretizations, physics packages) with exact source provenance and license data.

Use science_search first with a concrete technical query (an algorithm, equation, \
API or symbol name), optionally filtered by repositories, languages or licenses. \
Then use science_get_source or science_get_context on the returned result_id for \
full code, and science_get_symbol when you know an exact name. Before suggesting \
that code be copied or adapted, call science_check_license: GPL/AGPL and unknown \
licenses are reference-only. Cite repository, path and symbol for every claim \
taken from results, and say so when results don't cover the question."""

INVALID_REQUEST = -32600
INVALID_PARAMS = -32602
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603


class JsonRpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


def handle_request(db_path: str, message: Any, remote: bool = False) -> dict[str, Any] | None:
    """Handle one JSON-RPC message. remote=True for the HTTP transport, which
    hides tools that read the host's filesystem (see LOCAL_ONLY_TOOLS)."""
    if not isinstance(message, dict):
        # Includes JSON-RPC batches, which 2025-06-18 dropped.
        return {"jsonrpc": "2.0", "id": None, "error": {"code": INVALID_REQUEST, "message": "expected a JSON-RPC object"}}
    if "id" not in message:
        return None
    try:
        result = _result(db_path, message.get("method", ""), message.get("params") or {}, remote)
        return {"jsonrpc": "2.0", "id": message["id"], "result": result}
    except JsonRpcError as error:
        return {"jsonrpc": "2.0", "id": message["id"], "error": {"code": error.code, "message": str(error)}}
    except Exception as error:  # noqa: BLE001 - JSON-RPC returns structured errors
        return {"jsonrpc": "2.0", "id": message["id"], "error": {"code": INTERNAL_ERROR, "message": str(error)}}


def serve_stdio(db_path: str, stdin: BinaryIO | None = None, stdout: BinaryIO | None = None) -> None:
    input_stream = stdin or sys.stdin.buffer
    output_stream = stdout or sys.stdout.buffer
    while True:
        try:
            message = _read_message(input_stream)
        except json.JSONDecodeError:
            continue
        if message is None:
            break
        response = handle_request(db_path, message)
        if response is not None:
            _write_message(output_stream, response)


def _result(db_path: str, method: str, params: dict[str, Any], remote: bool) -> dict[str, Any]:
    if method == "initialize":
        requested = params.get("protocolVersion")
        return {
            "protocolVersion": requested if requested in SUPPORTED_PROTOCOL_VERSIONS else PROTOCOL_VERSION,
            "serverInfo": {"name": "physicscode-science", "title": "PhysicsCode Science", "version": SERVER_VERSION},
            "capabilities": {"tools": {"listChanged": False}},
            "instructions": INSTRUCTIONS,
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": tool_definitions(remote=remote)}
    if method == "tools/call":
        name = str(params.get("name", ""))
        try:
            payload = call_tool(db_path, name, dict(params.get("arguments") or {}), remote=remote)
        except UnknownToolError as error:
            raise JsonRpcError(INVALID_PARAMS, str(error)) from error
        except Exception as error:  # noqa: BLE001
            # Tool failures go back as a result the model can read and
            # recover from (bad object_id, missing argument, backend down),
            # not as a protocol error the client hides from it.
            message = f"missing required argument: {error}" if isinstance(error, KeyError) else str(error)
            return {"content": [{"type": "text", "text": f"{name} failed: {message}"}], "isError": True}
        return {
            "content": [{"type": "text", "text": json.dumps(payload, indent=2, sort_keys=True)}],
            "isError": False,
        }
    raise JsonRpcError(METHOD_NOT_FOUND, f"unsupported MCP method: {method}")


def _read_message(stream: BinaryIO) -> dict[str, Any] | None:
    # MCP's stdio transport is newline-delimited JSON-RPC, one message per
    # line - not LSP's Content-Length-framed headers. A framing mismatch
    # here means every real MCP client (Claude Code, Codex, ...) sees the
    # pipe go silent and reports the connection as closed.
    while True:
        line = stream.readline()
        if line == b"":
            return None
        line = line.strip()
        if not line:
            continue
        return json.loads(line.decode("utf-8"))


def _write_message(stream: BinaryIO, message: dict[str, Any]) -> None:
    body = json.dumps(message, separators=(",", ":"))
    stream.write((body + "\n").encode("utf-8"))
    stream.flush()
