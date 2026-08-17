import json
import subprocess
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.mcp.server import _read_message, _write_message, handle_request
from physicscode_science.mcp.tools import call_tool
from physicscode_science.models import RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.vector_index.local import build_local_vector_index


class McpTest(unittest.TestCase):
    def test_mcp_lists_and_calls_science_search(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = _index_fixture(root)

            listed = handle_request(str(db), {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
            called = handle_request(
                str(db),
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": "science_search", "arguments": {"query": "poisson solver", "top_k": 1}},
                },
            )

            self.assertEqual(listed["result"]["tools"][0]["name"], "science_search")
            payload = json.loads(called["result"]["content"][0]["text"])
            self.assertEqual(payload["results"][0]["symbol"], "poisson_solver")

    def test_tool_get_source_and_symbol(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = _index_fixture(root)
            search_payload = call_tool(str(db), "science_search", {"query": "poisson solver", "top_k": 1})
            object_id = search_payload["results"][0]["result_id"]

            source_payload = call_tool(str(db), "science_get_source", {"object_id": object_id})
            symbol_payload = call_tool(str(db), "science_get_symbol", {"symbol": "poisson_solver"})

            self.assertEqual(source_payload["source"]["object_id"], object_id)
            self.assertEqual(symbol_payload["results"][0]["symbol"], "poisson_solver")

    def test_science_status_reports_ready_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = _index_fixture(root)
            store = ScienceStore(db)
            try:
                store.migrate()
                build_local_vector_index(store)
            finally:
                store.close()

            payload = call_tool(str(db), "science_status", {})

            self.assertTrue(payload["ready"])
            self.assertEqual(payload["database"]["object_count"], 1)
            self.assertTrue(payload["vector_index"]["present"])

    def test_mcp_stdio_framing_round_trips(self):
        stream = BytesIO()
        _write_message(stream, {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}})
        stream.seek(0)

        message = _read_message(stream)

        self.assertEqual(message["result"], {"ok": True})


def _index_fixture(root: Path) -> Path:
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
    return db


def _init_git_repo(repo: Path) -> None:
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, stdout=subprocess.PIPE)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test User"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "initial"], check=True, stdout=subprocess.PIPE)


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
