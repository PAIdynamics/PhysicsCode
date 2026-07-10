import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.evaluation.benchmarks import evaluate_search
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import BenchmarkQuery, RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore


class EvaluationTest(unittest.TestCase):
    def test_evaluate_search_compares_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "LICENSE").write_text(
                "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
            )
            (repo / "solver.cpp").write_text(
                "int matrix_free_newton_krylov() {\n  return 0;\n}\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                ingest_repository(_config(repo), store, root / "reports")
                store.commit()

                report = evaluate_search(
                    store,
                    [
                        BenchmarkQuery(
                            query_id="q1",
                            query="matrix free newton krylov",
                            relevant_symbols=("matrix_free_newton_krylov",),
                            relevant_repositories=("example",),
                            languages=("cpp",),
                        )
                    ],
                )

                self.assertEqual(report["query_count"], 1)
                self.assertEqual(
                    set(report["modes"].keys()),
                    {"dense", "sparse", "symbol", "hybrid_no_rerank", "hybrid_rerank"},
                )
                self.assertGreater(report["modes"]["hybrid_rerank"]["recall_at_10"], 0)
                self.assertTrue(report["modes"]["hybrid_rerank"]["queries"][0]["rerank"])
                self.assertFalse(report["modes"]["hybrid_no_rerank"]["queries"][0]["rerank"])
            finally:
                store.close()


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
