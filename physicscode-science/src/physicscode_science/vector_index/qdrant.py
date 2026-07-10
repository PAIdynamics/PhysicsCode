from __future__ import annotations

import json
import uuid
from pathlib import Path
from urllib import request

from physicscode_science.models import SearchQuery
from physicscode_science.retrieval.vector import (
    DEFAULT_VECTOR_DIMENSIONS,
    dense_vector,
    vectorize_candidate,
    vectorize_query,
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
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.collection = collection
        self.dimensions = dimensions
        self.api_key = api_key

    def ensure_collection(self) -> None:
        payload = {
            "vectors": {
                "size": self.dimensions,
                "distance": "Cosine",
            }
        }
        self._request("PUT", f"/collections/{self.collection}", payload)

    def upsert_store(self, store: ScienceStore, batch_size: int = 128) -> dict[str, object]:
        candidates = store.search_candidates(SearchQuery(query="", top_k=1_000_000))
        self.ensure_collection()
        written = 0
        for offset in range(0, len(candidates), batch_size):
            batch = candidates[offset : offset + batch_size]
            points = [
                {
                    "id": _point_id(candidate.object_id),
                    "vector": dense_vector(vectorize_candidate(candidate, self.dimensions), self.dimensions),
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
            "object_count": written,
        }

    def search(self, query: str, limit: int = 50) -> dict[str, float]:
        payload = {
            "vector": dense_vector(vectorize_query(query, self.dimensions), self.dimensions),
            "limit": limit,
            "with_payload": True,
        }
        response = self._request("POST", f"/collections/{self.collection}/points/search", payload)
        return {
            str(item.get("payload", {}).get("object_id", item["id"])): float(item["score"])
            for item in response.get("result", [])
            if isinstance(item, dict) and "id" in item and "score" in item
        }

    def _request(self, method: str, path: str, payload: dict[str, object]) -> dict[str, object]:
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        req = request.Request(f"{self.base_url}{path}", data=body, headers=headers, method=method)
        with request.urlopen(req, timeout=30) as response:  # noqa: S310 - configured internal service URL
            content = response.read()
        if not content:
            return {}
        return json.loads(content.decode("utf-8"))


def qdrant_config_report(config_path: str | Path) -> dict[str, object]:
    return json.loads(Path(config_path).read_text(encoding="utf-8"))


def _point_id(object_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, object_id))
