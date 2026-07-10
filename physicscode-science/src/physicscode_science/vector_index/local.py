from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
import math
from pathlib import Path

from physicscode_science.embeddings.providers import (
    EmbeddingProvider,
    HashEmbeddingProvider,
    configured_embedding_provider,
)
from physicscode_science.models import SearchCandidate, SearchQuery
from physicscode_science.retrieval.vector import (
    DEFAULT_VECTOR_DIMENSIONS,
    dense_vector,
)
from physicscode_science.storage.sqlite import ScienceStore


LOCAL_INDEX_VERSION = "local-json-vector-index-v1"


@dataclass(frozen=True)
class VectorIndexEntry:
    object_id: str
    repository: str
    commit: str
    path: str
    vector: list[float]


def default_vector_index_path(store: ScienceStore) -> Path:
    return store.path.parent / "vector-index.json"


def build_local_vector_index(
    store: ScienceStore,
    path: str | Path | None = None,
    *,
    dimensions: int = DEFAULT_VECTOR_DIMENSIONS,
    embedding_provider: EmbeddingProvider | None = None,
) -> dict[str, object]:
    target = Path(path) if path else default_vector_index_path(store)
    target.parent.mkdir(parents=True, exist_ok=True)
    provider = embedding_provider or configured_embedding_provider(dimensions=dimensions)
    model = provider.model()
    candidates = store.search_candidates(SearchQuery(query="", top_k=1_000_000))
    entries = [
        {
            "object_id": candidate.object_id,
            "repository": candidate.repository,
            "commit": candidate.commit,
            "path": candidate.path,
            "vector": provider.embed_candidate(candidate),
        }
        for candidate in candidates
    ]
    payload = {
        "version": LOCAL_INDEX_VERSION,
        "backend": "local_json",
        "embedding_model": model.__dict__,
        "dimensions": model.dimensions,
        "object_count": len(entries),
        "built_at": datetime.now(UTC).isoformat(),
        "entries": entries,
    }
    target.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    return {
        "backend": "local_json",
        "path": str(target),
        "dimensions": model.dimensions,
        "embedding_model": model.__dict__,
        "object_count": len(entries),
    }


def local_vector_scores(
    query: str,
    candidates: list[SearchCandidate],
    path: str | Path,
) -> dict[str, float]:
    candidate_ids = {candidate.object_id for candidate in candidates}
    index = load_local_vector_index(path)
    embedding_model = index.get("embedding_model", {})
    if isinstance(embedding_model, dict) and embedding_model.get("fallback") is False:
        query_vector = configured_embedding_provider(
            dimensions=int(index["dimensions"]),
            allow_fallback=True,
        ).embed_text(query)
    else:
        query_vector = HashEmbeddingProvider(int(index["dimensions"])).embed_text(query)
    scores: dict[str, float] = {}
    for entry in index["entries"]:
        if entry.object_id not in candidate_ids:
            continue
        score = _cosine_dense(query_vector, entry.vector)
        if score > 0:
            scores[entry.object_id] = score
    return scores


def load_local_vector_index(path: str | Path) -> dict[str, object]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    dimensions = int(payload.get("dimensions", DEFAULT_VECTOR_DIMENSIONS))
    entries = [
        VectorIndexEntry(
            object_id=str(item["object_id"]),
            repository=str(item.get("repository", "")),
            commit=str(item.get("commit", "")),
            path=str(item.get("path", "")),
            vector=_vector(item.get("vector", []), dimensions),
        )
        for item in payload.get("entries", [])
        if isinstance(item, dict)
    ]
    return {
        "version": payload.get("version", ""),
        "backend": payload.get("backend", "local_json"),
        "embedding_model": payload.get("embedding_model", {}),
        "dimensions": dimensions,
        "object_count": int(payload.get("object_count", len(entries))),
        "built_at": payload.get("built_at", ""),
        "entries": entries,
    }


def _vector(items: object, dimensions: int) -> list[float]:
    if not isinstance(items, list):
        return []
    if items and isinstance(items[0], list):
        return dense_vector(
            {int(item[0]): float(item[1]) for item in items if isinstance(item, list) and len(item) == 2},
            dimensions,
        )
    return [float(item) for item in items]


def _cosine_dense(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, dot / (left_norm * right_norm))
