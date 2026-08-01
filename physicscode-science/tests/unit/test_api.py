import json
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from physicscode_science.api.server import _handler, search_payload
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore


class ApiTest(unittest.TestCase):
    def test_search_payload_returns_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "LICENSE").write_text(
                "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
            )
            (repo / "solver.cpp").write_text("int poisson_solver() {\n  return 0;\n}\n", encoding="utf-8")
            _init_git_repo(repo)
            db = root / "science.sqlite"
            store = ScienceStore(db)
            try:
                ingest_repository(_config(repo), store, root / "reports")
                store.commit()
            finally:
                store.close()

            payload = search_payload(str(db), {"query": "poisson solver", "top_k": 1})

            self.assertEqual(json.loads(json.dumps(payload))["results"][0]["symbol"], "poisson_solver")

    def test_streamable_http_mcp_initializes_and_accepts_notifications(self):
        with tempfile.TemporaryDirectory() as directory, _running_server(
            str(Path(directory) / "science.sqlite")
        ) as url:
            response = _post_json(
                f"{url}/mcp",
                {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            )
            self.assertEqual(response.status, 200)
            server_name = json.load(response)["result"]["serverInfo"]["name"]
            self.assertEqual(server_name, "physicscode-science")

            notification = _post_json(
                f"{url}/mcp",
                {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
            )
            self.assertEqual(notification.status, 202)

    def test_streamable_http_mcp_requires_configured_origin_key(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"PHYSICSCODE_SCIENCE_API_KEY": "origin-secret"}, clear=False
        ), _running_server(str(Path(directory) / "science.sqlite")) as url:
            payload = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
            with self.assertRaises(urllib.error.HTTPError) as caught:
                _post_json(f"{url}/mcp", payload)
            self.assertEqual(caught.exception.code, 401)

            response = _post_json(f"{url}/mcp", payload, token="origin-secret")
            self.assertEqual(response.status, 200)


def _init_git_repo(repo: Path) -> None:
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, stdout=subprocess.PIPE)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test User"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "initial"], check=True, stdout=subprocess.PIPE)


class _running_server:
    def __init__(self, db_path: str):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(db_path))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> str:
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_port}"

    def __exit__(self, *_args: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


def _post_json(url: str, payload: dict[str, object], token: str | None = None):
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        url, json.dumps(payload).encode("utf-8"), headers, method="POST"
    )
    return urllib.request.urlopen(request)


def _config(repo: Path) -> RepositoryConfig:
    return RepositoryConfig(
        name="example",
        url="https://example.invalid/example",
        local_path=str(repo),
        default_branch="main",
        revision_policy="fixed-local",
        license_policy="allowed",
        domains=("pde",),
        languages=("cpp",),
        priority="high",
        enabled=True,
    )


if __name__ == "__main__":
    unittest.main()
