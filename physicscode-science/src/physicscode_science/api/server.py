from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from physicscode_science.models import SearchQuery
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore


def run_server(db_path: str, host: str = "127.0.0.1", port: int = 8765) -> None:
    server = ThreadingHTTPServer((host, port), _handler(db_path))
    server.serve_forever()


def _handler(db_path: str) -> type[BaseHTTPRequestHandler]:
    class ScienceHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                _send_json(self, 200, {"status": "ok"})
                return
            _send_json(self, 404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/v1/search":
                _send_json(self, 404, {"error": "not found"})
                return
            try:
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                _send_json(self, 200, search_payload(db_path, payload))
            except Exception as error:  # noqa: BLE001
                _send_json(self, 400, {"error": str(error)})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

    return ScienceHandler


def search_payload(db_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    store = ScienceStore(db_path)
    try:
        store.migrate()
        results = search(store, _query(payload))
    finally:
        store.close()
    return {"results": [asdict(result) for result in results]}


def _query(payload: dict[str, Any]) -> SearchQuery:
    return SearchQuery(
        query=str(payload["query"]),
        repositories=tuple(payload.get("repositories", [])),
        domains=tuple(payload.get("domains", [])),
        languages=tuple(payload.get("languages", [])),
        object_types=tuple(payload.get("object_types", [])),
        licenses=tuple(payload.get("licenses", [])),
        retrieval_channels=tuple(payload.get("retrieval_channels", ["dense", "sparse", "symbol"])),
        rerank=bool(payload.get("rerank", True)),
        deduplicate=bool(payload.get("deduplicate", True)),
        diversity=bool(payload.get("diversity", True)),
        top_k=int(payload.get("top_k", 10)),
        include_content=bool(payload.get("include_content", False)),
    )


def _send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
