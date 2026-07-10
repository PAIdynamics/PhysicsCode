import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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

    def test_qdrant_dense_search_skips_without_embedding_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text(
                "int poisson_solver() { return 0; }\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = _store_with_repo(root, repo)
            try:
                with mock.patch.dict(
                    "os.environ",
                    {"PHYSICSCODE_SCIENCE_VECTOR_BACKEND": "qdrant"},
                    clear=True,
                ):
                    with mock.patch(
                        "physicscode_science.retrieval.search.QdrantVectorIndex.search",
                    ) as qdrant_search:
                        results = search(
                            store,
                            SearchQuery(
                                "poisson",
                                retrieval_channels=("dense",),
                                top_k=1,
                            ),
                        )

                self.assertEqual(results, [])
                qdrant_search.assert_not_called()
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

    def test_qdrant_search_does_not_use_hash_fallback(self):
        index = QdrantVectorIndex("http://qdrant.invalid", "science", dimensions=1024)

        with mock.patch.dict(
            "os.environ",
            {
                "PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER": "vllm",
                "PHYSICSCODE_SCIENCE_EMBEDDING_MODEL": "paidynamics/bge-m3-pai",
                "PHYSICSCODE_SCIENCE_EMBEDDING_URL": "http://127.0.0.1:1",
            },
            clear=True,
        ):
            with self.assertRaises(Exception):
                index.search("poisson")

    def test_qdrant_search_infers_collection_dimensions(self):
        class Provider:
            def model(self):  # noqa: ANN202
                from physicscode_science.embeddings.providers import EmbeddingModel

                return EmbeddingModel(
                    provider="test",
                    model="test-embedding",
                    dimensions=1024,
                    version="test",
                )

            def embed_text(self, text):  # noqa: ANN001, ANN202
                return [0.1] * 1024

        class ExistingCollection(QdrantVectorIndex):
            def _request(self, method, path, payload=None, **kwargs):  # noqa: ANN001, ANN202
                self.last_request = (method, path, payload)
                if path == "/collections/science":
                    return {
                        "result": {
                            "config": {
                                "params": {
                                    "vectors": {
                                        "size": 1024,
                                    }
                                }
                            }
                        }
                    }
                return {
                    "result": [
                        {
                            "id": "point-1",
                            "score": 0.42,
                            "payload": {"object_id": "object-1"},
                        }
                    ]
                }

        index = ExistingCollection(
            "http://qdrant.invalid",
            "science",
            dimensions=1536,
            embedding_provider=Provider(),
        )

        scores = index.search("poisson")

        self.assertEqual(scores, {"object-1": 0.42})
        self.assertEqual(index.dimensions, 1024)
        self.assertEqual(len(index.last_request[2]["vector"]), 1024)

    def test_qdrant_multi_vector_collection_payload(self):
        class CreatedCollection(QdrantVectorIndex):
            def __init__(self):  # noqa: ANN204
                super().__init__(
                    "http://qdrant.invalid",
                    "science",
                    dimensions=384,
                    vector_mode="multi",
                    named_vectors=("summary", "source"),
                )
                self.requests = []

            def _request(self, method, path, payload=None, **kwargs):  # noqa: ANN001, ANN202
                self.requests.append((method, path, payload))
                if method == "GET":
                    from urllib.error import HTTPError

                    raise HTTPError("http://qdrant.invalid", 404, "not found", {}, None)
                return {}

        index = CreatedCollection()

        index.ensure_collection()

        self.assertEqual(index.requests[-1][0], "PUT")
        self.assertEqual(index.requests[-1][2]["vectors"]["summary"]["size"], 384)
        self.assertEqual(index.requests[-1][2]["vectors"]["source"]["distance"], "Cosine")

    def test_qdrant_multi_vector_search_fuses_named_vectors(self):
        class Provider:
            def model(self):  # noqa: ANN202
                from physicscode_science.embeddings.providers import EmbeddingModel

                return EmbeddingModel(
                    provider="test",
                    model="test-embedding",
                    dimensions=384,
                    version="test",
                )

            def embed_text(self, text):  # noqa: ANN001, ANN202
                return [0.1] * 384

        class ExistingCollection(QdrantVectorIndex):
            def _request(self, method, path, payload=None, **kwargs):  # noqa: ANN001, ANN202
                if path == "/collections/science":
                    return {
                        "result": {
                            "config": {
                                "params": {
                                    "vectors": {
                                        "summary": {"size": 384, "distance": "Cosine"},
                                        "source": {"size": 384, "distance": "Cosine"},
                                    }
                                }
                            }
                        }
                    }
                self.last_search_payload = payload
                return {
                    "result": [
                        {
                            "id": "point-1",
                            "score": 0.8,
                            "payload": {"object_id": "object-1"},
                        }
                    ]
                }

        index = ExistingCollection(
            "http://qdrant.invalid",
            "science",
            embedding_provider=Provider(),
        )

        scores = index.search("poisson")

        self.assertIn("object-1", scores)
        self.assertEqual(index.vector_mode, "multi")
        self.assertEqual(index.last_search_payload["vector"]["name"], "source")


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
