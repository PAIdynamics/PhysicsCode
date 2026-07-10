from __future__ import annotations

import json
import sys
from typing import Any, BinaryIO

from physicscode_science.mcp.tools import call_tool, tool_definitions

PROTOCOL_VERSION = "2024-11-05"


def handle_request(db_path: str, message: dict[str, Any]) -> dict[str, Any] | None:
    if "id" not in message:
        return None
    try:
        result = _result(db_path, message.get("method", ""), message.get("params", {}))
        return {"jsonrpc": "2.0", "id": message["id"], "result": result}
    except Exception as error:  # noqa: BLE001 - JSON-RPC returns structured errors
        return {
            "jsonrpc": "2.0",
            "id": message["id"],
            "error": {"code": -32000, "message": str(error)},
        }


def serve_stdio(db_path: str, stdin: BinaryIO | None = None, stdout: BinaryIO | None = None) -> None:
    input_stream = stdin or sys.stdin.buffer
    output_stream = stdout or sys.stdout.buffer
    while True:
        message = _read_message(input_stream)
        if message is None:
            break
        response = handle_request(db_path, message)
        if response is not None:
            _write_message(output_stream, response)


def _result(db_path: str, method: str, params: dict[str, Any]) -> dict[str, Any]:
    if method == "initialize":
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "serverInfo": {"name": "physicscode-science", "version": "0.1.0"},
            "capabilities": {"tools": {}},
        }
    if method == "tools/list":
        return {"tools": tool_definitions()}
    if method == "tools/call":
        payload = call_tool(db_path, str(params["name"]), dict(params.get("arguments", {})))
        return {
            "content": [{"type": "text", "text": json.dumps(payload, indent=2, sort_keys=True)}],
            "isError": False,
        }
    raise ValueError(f"unsupported MCP method: {method}")


def _read_message(stream: BinaryIO) -> dict[str, Any] | None:
    headers: dict[str, str] = {}
    while True:
        line = stream.readline()
        if line == b"":
            return None
        if line in {b"\r\n", b"\n"}:
            break
        key, value = line.decode("ascii").split(":", 1)
        headers[key.lower()] = value.strip()
    content_length = int(headers["content-length"])
    return json.loads(stream.read(content_length).decode("utf-8"))


def _write_message(stream: BinaryIO, message: dict[str, Any]) -> None:
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    stream.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    stream.write(body)
    stream.flush()
