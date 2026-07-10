from __future__ import annotations

import json
import uuid
from pathlib import Path
from urllib import error, request

from physicscode_science.embeddings.providers import EmbeddingProvider, configured_embedding_provider
from physicscode_science.models import SearchQuery
from physicscode_science.retrieval.vector import (
    DEFAULT_VECTOR_DIMENSIONS,
)
from physicscode_science.storage.sqlite import ScienceStore


class QdrantVectorIndex:
    def __init__(
        self,
        base_url: str,
        collection: str = "physicscode_science_summary",
        *,
        dimensions: int = DEFAULT_VECTOR_DIMENSIONS,
        api_key: str | None = None,
        embedding_provider: EmbeddingProvider | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.collection = collection
        self.dimensions = dimensions
        self.api_key = api_key
        self.embedding_provider = embedding_provider

    def ensure_collection(self) -> None:
        try:
            existing = self._request("GET", f"/collections/{self.collection}", wrap_http_errors=False)
        except error.HTTPError as exc:
            if exc.code != 404:
                raise
        else:
            existing_dimensions = (
                existing.get("result", {})
                .get("config", {})
                .get("params", {})
                .get("vectors", {})
                .get("size")
            )
            if existing_dimensions != self.dimensions:
                raise ValueError(
                    f"Qdrant collection {self.collection!r} has vector size "
                    f"{existing_dimensions}, expected {self.dimensions}"
                )
            return

        payload = {
            "vectors": {
                "size": self.dimensions,
                "distance": "Cosine",
            }
        }
        self._request("PUT", f"/collections/{self.collection}", payload)

    def collection_dimensions(self) -> int:
        existing = self._request("GET", f"/collections/{self.collection}")
        dimensions = (
            existing.get("result", {})
            .get("config", {})
            .get("params", {})
            .get("vectors", {})
            .get("size")
        )
        if not isinstance(dimensions, int):
            raise RuntimeError(f"Qdrant collection {self.collection!r} does not expose vector size")
        return dimensions

    def upsert_store(self, store: ScienceStore, batch_size: int = 128) -> dict[str, object]:
        candidates = store.search_candidates(SearchQuery(query="", top_k=1_000_000))
        provider = self.embedding_provider or configured_embedding_provider(dimensions=self.dimensions)
        model = provider.model()
        self.dimensions = model.dimensions
        self.ensure_collection()
        written = 0
        for offset in range(0, len(candidates), batch_size):
            batch = candidates[offset : offset + batch_size]
            points = [
                {
                    "id": _point_id(candidate.object_id),
                    "vector": provider.embed_candidate(candidate),
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
                        "embedding_model": model.__dict__,
                    },
                }
                for candidate in batch
            ]
            self._request("PUT", f"/collections/{self.collection}/points", {"points": points})
            written += len(points)
        return {
            "backend": "qdrant",
            "url": self.base_url,
            "collection": self.collection,
            "dimensions": self.dimensions,
            "embedding_model": model.__dict__,
            "object_count": written,
        }

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
        payload = {
            "vector": provider.embed_text(query),
            "limit": limit,
            "with_payload": True,
        }
        response = self._request("POST", f"/collections/{self.collection}/points/search", payload)
        return {
            str(item.get("payload", {}).get("object_id", item["id"])): float(item["score"])
            for item in response.get("result", [])
            if isinstance(item, dict) and "id" in item and "score" in item
        }

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


def _point_id(object_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, object_id))
