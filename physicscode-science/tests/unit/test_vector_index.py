import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig, SearchQuery
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.vector_index.local import (
    build_local_vector_index,
    default_vector_index_path,
    load_local_vector_index,
    local_vector_scores,
)
from physicscode_science.vector_index.qdrant import QdrantVectorIndex


class VectorIndexTest(unittest.TestCase):
    def test_build_local_vector_index_persists_source_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text(
                "int poisson_multigrid_solver() { return 0; }\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = _store_with_repo(root, repo)
            try:
                report = build_local_vector_index(store)
                index = load_local_vector_index(default_vector_index_path(store))

                self.assertEqual(report["object_count"], 1)
                self.assertEqual(index["object_count"], 1)
                self.assertEqual(index["backend"], "local_json")
                self.assertGreater(len(index["entries"][0].vector), 0)
            finally:
                store.close()

    def test_search_uses_local_vector_index_for_dense_channel(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text(
                """
int unrelated_helper() { return 0; }
int poisson_multigrid_solver() { return 1; }
""",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = _store_with_repo(root, repo)
            try:
                build_local_vector_index(store)

                results = search(
                    store,
                    SearchQuery(
                        "poisson multigrid",
                        retrieval_channels=("dense",),
                        top_k=1,
                    ),
                )

                self.assertEqual(results[0].symbol, "poisson_multigrid_solver")
                self.assertEqual(results[0].retrieval_channels, ("dense",))
                self.assertIn("dense", results[0].reason)
            finally:
                store.close()

    def test_local_vector_scores_respect_filtered_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text(
                "int poisson_solver() { return 0; }\nint heat_solver() { return 1; }\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = _store_with_repo(root, repo)
            try:
                build_local_vector_index(store)
                candidates = [
                    candidate
                    for candidate in store.search_candidates(SearchQuery("heat"))
                    if candidate.symbol == "heat_solver"
                ]

                scores = local_vector_scores("poisson solver", candidates, default_vector_index_path(store))

                self.assertEqual(set(scores), {candidates[0].object_id})
            finally:
                store.close()

    def test_qdrant_collection_dimension_mismatch_fails(self):
        class ExistingCollection(QdrantVectorIndex):
            def _request(self, method, path, payload=None, **kwargs):  # noqa: ANN001, ANN202
                self.last_request = (method, path, payload)
                return {
                    "result": {
                        "config": {
                            "params": {
                                "vectors": {
                                    "size": 1536,
                                }
                            }
                        }
                    }
                }

        index = ExistingCollection("http://qdrant.invalid", "science", dimensions=384)

        with self.assertRaisesRegex(ValueError, "vector size 1536, expected 384"):
            index.ensure_collection()


def _store_with_repo(root: Path, repo: Path) -> ScienceStore:
    store = ScienceStore(root / ".science" / "physicscode-science.sqlite")
    ingest_repository(_config(repo), store, root / "reports")
    store.commit()
    return store


def _repo(root: Path) -> Path:
    repo = root / "repo"
    repo.mkdir()
    (repo / "LICENSE").write_text(
        "MIT License\n\nPermission is hereby granted, free of charge\n",
        encoding="utf-8",
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
