import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig, SearchQuery
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore


class RerankingTest(unittest.TestCase):
    def test_search_result_contains_rerank_explanation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = _index_fixture(root)
            store = ScienceStore(db)
            try:
                results = search(store, SearchQuery("poisson solver", top_k=1))

                self.assertEqual(results[0].symbol, "poisson_solver")
                self.assertEqual(results[0].explanation["reranker"], "deterministic-reranker-v1")
                self.assertIn("reranked", results[0].reason)
            finally:
                store.close()

    def test_reranking_can_be_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = _index_fixture(root)
            store = ScienceStore(db)
            try:
                results = search(store, SearchQuery("poisson solver", top_k=1, rerank=False))

                self.assertEqual(results[0].explanation["reranker"], "disabled")
            finally:
                store.close()

    def test_deduplication_suppresses_same_file_window(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text(
                "\n".join(
                    [
                        "int poisson_solver() { return 0; }",
                        "int poisson_solver_variant() { return poisson_solver(); }",
                    ]
                ),
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                ingest_repository(_config(repo), store, root / "reports")
                store.commit()

                deduped = search(store, SearchQuery("poisson solver", top_k=10, deduplicate=True))
                raw = search(store, SearchQuery("poisson solver", top_k=10, deduplicate=False))

                self.assertLess(len(deduped), len(raw))
            finally:
                store.close()


def _index_fixture(root: Path) -> Path:
    repo = _repo(root)
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


def _repo(root: Path) -> Path:
    repo = root / "repo"
    repo.mkdir()
    (repo / "LICENSE").write_text(
        "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
    )
    return repo


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
