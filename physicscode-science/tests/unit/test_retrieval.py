import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig, SearchQuery
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore


class RetrievalTest(unittest.TestCase):
    def test_hybrid_search_returns_provenance_and_channels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "kernels.cpp").write_text(
                """
void deposit_charge_cloud_in_cell() {
  // cloud in cell charge deposition
}

void solve_heat_equation() {
}
""",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                ingest_repository(_config(repo), store, root / "reports")
                store.commit()

                results = search(
                    store,
                    SearchQuery("cloud in cell charge deposition", languages=("cpp",), top_k=3),
                )

                self.assertGreaterEqual(len(results), 1)
                self.assertEqual(results[0].symbol, "deposit_charge_cloud_in_cell")
                self.assertEqual(results[0].repository, "example")
                self.assertEqual(results[0].commit, _head(repo))
                self.assertIn("sparse", results[0].retrieval_channels)
                self.assertTrue(results[0].path.endswith("kernels.cpp"))
            finally:
                store.close()

    def test_search_filters_by_license_and_object_type(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "README.md").write_text("# Matrix-free Newton Krylov\n", encoding="utf-8")
            (repo / "solver.cpp").write_text("int newton_krylov_solver() {\n  return 0;\n}\n", encoding="utf-8")
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                ingest_repository(_config(repo), store, root / "reports")
                store.commit()

                docs = search(
                    store,
                    SearchQuery(
                        "matrix free newton krylov",
                        object_types=("documentation-section",),
                        licenses=("MIT",),
                        top_k=5,
                    ),
                )
                functions = search(
                    store,
                    SearchQuery(
                        "matrix free newton krylov",
                        object_types=("function",),
                        licenses=("MIT",),
                        top_k=5,
                    ),
                )

                self.assertEqual([result.object_type for result in docs], ["documentation-section"])
                self.assertEqual([result.object_type for result in functions], ["function"])
            finally:
                store.close()


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


def _head(repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.strip()


def _config(repo: Path) -> RepositoryConfig:
    return RepositoryConfig(
        name="example",
        url="https://example.invalid/example",
        local_path=str(repo),
        default_branch="main",
        revision_policy="fixed-local",
        license_policy="allowed",
        domains=("pde",),
        languages=("cpp", "markdown"),
        priority="high",
        enabled=True,
    )


if __name__ == "__main__":
    unittest.main()
