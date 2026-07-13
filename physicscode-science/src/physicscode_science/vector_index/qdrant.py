from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path
from urllib import error, request

from physicscode_science.embeddings.providers import (
    EmbeddingProvider,
    candidate_embedding_text,
    candidate_embedding_views,
    configured_embedding_provider,
)
from physicscode_science.models import SearchCandidate, SearchQuery
from physicscode_science.retrieval.fusion import reciprocal_rank_fusion
from physicscode_science.retrieval.vector import DEFAULT_VECTOR_DIMENSIONS
from physicscode_science.storage.sqlite import ScienceStore

DEFAULT_NAMED_VECTORS = ("summary", "signature", "source", "documentation")
DEFAULT_NAMED_VECTOR_WEIGHTS = {
    "summary": 1.0,
    "signature": 0.9,
    "source": 0.85,
    "documentation": 0.8,
}


class QdrantVectorIndex:
    def __init__(
        self,
        base_url: str,
        collection: str = "physicscode_science_summary",
        *,
        dimensions: int = DEFAULT_VECTOR_DIMENSIONS,
        api_key: str | None = None,
        embedding_provider: EmbeddingProvider | None = None,
        vector_mode: str = "single",
        named_vectors: tuple[str, ...] = DEFAULT_NAMED_VECTORS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.collection = collection
        self.dimensions = dimensions
        self.api_key = api_key
        self.embedding_provider = embedding_provider
        self.vector_mode = vector_mode
        self.named_vectors = named_vectors

    def ensure_collection(self) -> None:
        try:
            existing = self._request("GET", f"/collections/{self.collection}", wrap_http_errors=False)
        except error.HTTPError as exc:
            if exc.code != 404:
                raise
        else:
            vectors = _vectors_config(existing)
            self._validate_existing_vectors(vectors)
            return

        if self.vector_mode == "multi":
            vectors: dict[str, object] = {
                name: {
                    "size": self.dimensions,
                    "distance": "Cosine",
                }
                for name in self.named_vectors
            }
        else:
            vectors = {
                "size": self.dimensions,
                "distance": "Cosine",
            }
        self._request("PUT", f"/collections/{self.collection}", {"vectors": vectors})

    def collection_dimensions(self) -> int:
        existing = self._request("GET", f"/collections/{self.collection}")
        vectors = _vectors_config(existing)
        if _is_named_vectors(vectors):
            self.vector_mode = "multi"
            self.named_vectors = tuple(str(name) for name in vectors)
            dimensions = next(iter(vectors.values())).get("size")
        else:
            self.vector_mode = "single"
            dimensions = vectors.get("size") if isinstance(vectors, dict) else None
        if not isinstance(dimensions, int):
            raise RuntimeError(f"Qdrant collection {self.collection!r} does not expose vector size")
        return dimensions

    def upsert_store(
        self,
        store: ScienceStore,
        batch_size: int = 128,
        repositories: tuple[str, ...] = (),
    ) -> dict[str, object]:
        candidates = store.search_candidates(
            SearchQuery(query="", top_k=1_000_000, repositories=repositories)
        )
        provider = self.embedding_provider or configured_embedding_provider(
            dimensions=self.dimensions,
            allow_fallback=False,
        )
        model = provider.model()
        self.dimensions = model.dimensions
        self.ensure_collection()
        for repository in repositories:
            self.delete_repository(repository)
        written = 0
        batch_size = _effective_batch_size(batch_size, self.vector_mode)
        for offset in range(0, len(candidates), batch_size):
            batch = candidates[offset : offset + batch_size]
            points = _points(batch, provider, model.__dict__, self.vector_mode, self.named_vectors)
            self._request("PUT", f"/collections/{self.collection}/points", {"points": points})
            written += len(points)
            if os.environ.get("PHYSICSCODE_SCIENCE_VECTOR_PROGRESS"):
                print(
                    f"indexed {written}/{len(candidates)} objects into {self.collection}",
                    file=sys.stderr,
                    flush=True,
                )
        return {
            "backend": "qdrant",
            "url": self.base_url,
            "collection": self.collection,
            "dimensions": self.dimensions,
            "vector_mode": self.vector_mode,
            "named_vectors": self.named_vectors if self.vector_mode == "multi" else (),
            "embedding_model": model.__dict__,
            "object_count": written,
            "repositories": repositories,
        }

    def delete_repository(self, repository: str) -> None:
        self._request(
            "POST",
            f"/collections/{self.collection}/points/delete",
            {
                "filter": {
                    "must": [
                        {
                            "key": "repository",
                            "match": {"value": repository},
                        }
                    ]
                }
            },
        )

    def search(self, query: str, limit: int = 50) -> dict[str, float]:
        self.dimensions = self.collection_dimensions()
        provider = self.embedding_provider or configured_embedding_provider(
            dimensions=self.dimensions,
            allow_fallback=False,
        )
        model = provider.model()
        if model.dimensions != self.dimensions:
            raise ValueError(
                f"Qdrant collection {self.collection!r} expects {self.dimensions}-dimensional "
                f"vectors, but embedding model {model.model!r} returns {model.dimensions}"
            )
        query_vector = provider.embed_text(query)
        if self.vector_mode == "multi":
            channel_scores = {
                f"dense:{name}": self._search_named_vector(name, query_vector, limit)
                for name in self.named_vectors
            }
            fused, _ = reciprocal_rank_fusion(channel_scores)
            return fused
        response = self._search_points(query_vector, limit)
        return _scores_from_response(response)

    def _search_named_vector(self, name: str, query_vector: list[float], limit: int) -> dict[str, float]:
        response = self._search_points({"name": name, "vector": query_vector}, limit)
        weight = DEFAULT_NAMED_VECTOR_WEIGHTS.get(name, 1.0)
        return {
            object_id: score * weight
            for object_id, score in _scores_from_response(response).items()
        }

    def _search_points(self, vector: list[float] | dict[str, object], limit: int) -> dict[str, object]:
        return self._request(
            "POST",
            f"/collections/{self.collection}/points/search",
            {
                "vector": vector,
                "limit": limit,
                "with_payload": True,
            },
        )

    def _validate_existing_vectors(self, vectors: object) -> None:
        if self.vector_mode == "multi":
            if not _is_named_vectors(vectors):
                raise ValueError(f"Qdrant collection {self.collection!r} is not a named-vector collection")
            missing = set(self.named_vectors) - set(vectors)
            if missing:
                raise ValueError(
                    f"Qdrant collection {self.collection!r} is missing named vectors: "
                    f"{', '.join(sorted(missing))}"
                )
            mismatches = [
                name
                for name in self.named_vectors
                if vectors.get(name, {}).get("size") != self.dimensions
            ]
            if mismatches:
                raise ValueError(
                    f"Qdrant collection {self.collection!r} has vector size mismatches for: "
                    f"{', '.join(sorted(mismatches))}; expected {self.dimensions}"
                )
            return

        existing_dimensions = vectors.get("size") if isinstance(vectors, dict) else None
        if existing_dimensions != self.dimensions:
            raise ValueError(
                f"Qdrant collection {self.collection!r} has vector size "
                f"{existing_dimensions}, expected {self.dimensions}"
            )

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
        *,
        wrap_http_errors: bool = True,
    ) -> dict[str, object]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        req = request.Request(f"{self.base_url}{path}", data=body, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=30) as response:  # noqa: S310 - configured internal service URL
                content = response.read()
        except error.HTTPError as exc:
            if not wrap_http_errors:
                raise
            content = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Qdrant {method} {path} failed with HTTP {exc.code}: {content}") from exc
        if not content:
            return {}
        return json.loads(content.decode("utf-8"))


def qdrant_config_report(config_path: str | Path) -> dict[str, object]:
    return json.loads(Path(config_path).read_text(encoding="utf-8"))


def _points(
    candidates: list[SearchCandidate],
    provider: EmbeddingProvider,
    model: dict[str, object],
    vector_mode: str,
    named_vectors: tuple[str, ...],
) -> list[dict[str, object]]:
    if vector_mode == "multi":
        return _multi_vector_points(candidates, provider, model, named_vectors)
    max_chars = _max_candidate_chars(provider)
    texts = [candidate_embedding_text(candidate, max_raw_chars=max_chars)[:max_chars] for candidate in candidates]
    vectors = provider.embed_texts(texts)
    return [
        _point_payload(candidate, vector, model)
        for candidate, vector in zip(candidates, vectors, strict=True)
    ]


def _multi_vector_points(
    candidates: list[SearchCandidate],
    provider: EmbeddingProvider,
    model: dict[str, object],
    named_vectors: tuple[str, ...],
) -> list[dict[str, object]]:
    candidate_views = [
        candidate_embedding_views(candidate, max_raw_chars=_max_candidate_chars(provider))
        for candidate in candidates
    ]
    vectors_by_name: dict[str, list[list[float]]] = {}
    for name in named_vectors:
        texts = [views.get(name, views["summary"]) for views in candidate_views]
        vectors_by_name[name] = provider.embed_texts(texts)
    points = []
    for index, candidate in enumerate(candidates):
        points.append(
            _point_payload(
                candidate,
                {name: vectors_by_name[name][index] for name in named_vectors},
                model,
            )
        )
    return points


def _point_payload(
    candidate: SearchCandidate,
    vector: list[float] | dict[str, list[float]],
    model: dict[str, object],
) -> dict[str, object]:
    return {
        "id": _point_id(candidate.object_id),
        "vector": vector,
        "payload": {
            "object_id": candidate.object_id,
            "repository": candidate.repository,
            "commit": candidate.commit,
            "path": candidate.path,
            "symbol": candidate.symbol,
            "object_type": candidate.object_type,
            "language": candidate.language,
            "license": candidate.license,
            "metadata": candidate.metadata,
            "embedding_model": model,
        },
    }


def _scores_from_response(response: dict[str, object]) -> dict[str, float]:
    return {
        str(item.get("payload", {}).get("object_id", item["id"])): float(item["score"])
        for item in response.get("result", [])
        if isinstance(item, dict) and "id" in item and "score" in item
    }


def _max_candidate_chars(provider: EmbeddingProvider) -> int:
    return int(getattr(provider, "max_candidate_chars", 8000))


def _effective_batch_size(batch_size: int, vector_mode: str) -> int:
    override = os.environ.get("PHYSICSCODE_SCIENCE_VECTOR_BATCH_SIZE")
    if override:
        return max(1, int(override))
    if vector_mode == "multi":
        return min(batch_size, 16)
    return batch_size


def _vectors_config(response: dict[str, object]) -> object:
    return (
        response.get("result", {})
        .get("config", {})
        .get("params", {})
        .get("vectors", {})
    )


def _is_named_vectors(vectors: object) -> bool:
    return (
        isinstance(vectors, dict)
        and bool(vectors)
        and "size" not in vectors
        and all(isinstance(value, dict) and "size" in value for value in vectors.values())
    )


def _point_id(object_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, object_id))
