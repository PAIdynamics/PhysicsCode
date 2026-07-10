import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.graph.context import get_context
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.mcp.tools import call_tool
from physicscode_science.models import RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore


class ContextExpansionTest(unittest.TestCase):
    def test_context_expands_to_called_helper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = _index_fixture(root)
            store = ScienceStore(db)
            try:
                context = get_context(store, "solve helper", top_k=1, max_chars=6000)

                related = context["context"][0]["related"]
                self.assertTrue(any(item["relationship_type"] == "symbol-calls-symbol" for item in related))
                self.assertTrue(any(item["object"]["symbol"] == "helper" for item in related))
            finally:
                store.close()

    def test_mcp_context_respects_budget_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = _index_fixture(root)

            payload = call_tool(str(db), "science_get_context", {"query": "solve helper", "top_k": 1, "max_chars": 1200})

            self.assertEqual(payload["query"], "solve helper")
            self.assertLessEqual(len(str(payload)), 1800)
            self.assertIn("context", payload)


def _index_fixture(root: Path) -> Path:
    repo = root / "repo"
    repo.mkdir()
    (repo / "LICENSE").write_text(
        "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
    )
    (repo / "solver.cpp").write_text(
        "int helper() {\n  return 1;\n}\n\nint solve() {\n  return helper();\n}\n",
        encoding="utf-8",
    )
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
