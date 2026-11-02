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

    def test_initialize_negotiates_protocol_version(self):
        def initialize(version):
            return handle_request(
                "unused.sqlite",
                {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": version}},
            )["result"]

        self.assertEqual(initialize("2025-06-18")["protocolVersion"], "2025-06-18")
        self.assertEqual(initialize("2024-11-05")["protocolVersion"], "2024-11-05")
        self.assertEqual(initialize("1999-01-01")["protocolVersion"], "2025-06-18")
        result = initialize("2025-06-18")
        self.assertIn("science_search", result["instructions"])
        self.assertEqual(result["serverInfo"]["title"], "PhysicsCode Science")

    def test_ping_and_unknown_method(self):
        self.assertEqual(handle_request("unused.sqlite", {"jsonrpc": "2.0", "id": 1, "method": "ping"})["result"], {})
        unknown = handle_request("unused.sqlite", {"jsonrpc": "2.0", "id": 2, "method": "resources/list"})
        self.assertEqual(unknown["error"]["code"], -32601)

    def test_tools_are_annotated_read_only(self):
        tools = handle_request("unused.sqlite", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]
        for tool in tools:
            self.assertTrue(tool["title"])
            self.assertTrue(tool["annotations"]["readOnlyHint"])
        self.assertIn("science_project_context", {tool["name"] for tool in tools})

    def test_tool_failures_are_results_the_model_can_read(self):
        with tempfile.TemporaryDirectory() as directory:
            db = _index_fixture(Path(directory))
            missing_arg = handle_request(
                str(db),
                {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "science_get_source", "arguments": {}}},
            )
            self.assertTrue(missing_arg["result"]["isError"])
            self.assertIn("object_id", missing_arg["result"]["content"][0]["text"])

            unknown = handle_request(
                str(db),
                {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "nope", "arguments": {}}},
            )
            self.assertEqual(unknown["error"]["code"], -32602)

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
