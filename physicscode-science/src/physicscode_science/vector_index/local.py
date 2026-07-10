from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from physicscode_science.models import SearchCandidate, SearchQuery
from physicscode_science.retrieval.vector import (
    DEFAULT_VECTOR_DIMENSIONS,
    cosine,
    vectorize_candidate,
    vectorize_query,
)
from physicscode_science.storage.sqlite import ScienceStore


LOCAL_INDEX_VERSION = "local-json-vector-index-v1"


@dataclass(frozen=True)
class VectorIndexEntry:
    object_id: str
    repository: str
    commit: str
    path: str
    vector: dict[int, float]


def default_vector_index_path(store: ScienceStore) -> Path:
    return store.path.parent / "vector-index.json"


def build_local_vector_index(
    store: ScienceStore,
    path: str | Path | None = None,
    *,
    dimensions: int = DEFAULT_VECTOR_DIMENSIONS,
) -> dict[str, object]:
    target = Path(path) if path else default_vector_index_path(store)
    target.parent.mkdir(parents=True, exist_ok=True)
    candidates = store.search_candidates(SearchQuery(query="", top_k=1_000_000))
    entries = [
        {
            "object_id": candidate.object_id,
            "repository": candidate.repository,
            "commit": candidate.commit,
            "path": candidate.path,
            "vector": _pack(vectorize_candidate(candidate, dimensions)),
        }
        for candidate in candidates
    ]
    payload = {
        "version": LOCAL_INDEX_VERSION,
        "backend": "local_json",
        "dimensions": dimensions,
        "object_count": len(entries),
        "built_at": datetime.now(UTC).isoformat(),
        "entries": entries,
    }
    target.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    return {
        "backend": "local_json",
        "path": str(target),
        "dimensions": dimensions,
        "object_count": len(entries),
    }


def local_vector_scores(
    query: str,
    candidates: list[SearchCandidate],
    path: str | Path,
) -> dict[str, float]:
    candidate_ids = {candidate.object_id for candidate in candidates}
    index = load_local_vector_index(path)
    query_vector = vectorize_query(query, int(index["dimensions"]))
    scores: dict[str, float] = {}
    for entry in index["entries"]:
        if entry.object_id not in candidate_ids:
            continue
        score = cosine(query_vector, entry.vector)
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
            vector=_unpack(item.get("vector", [])),
        )
        for item in payload.get("entries", [])
        if isinstance(item, dict)
    ]
    return {
        "version": payload.get("version", ""),
        "backend": payload.get("backend", "local_json"),
        "dimensions": dimensions,
        "object_count": int(payload.get("object_count", len(entries))),
        "built_at": payload.get("built_at", ""),
        "entries": entries,
    }


def _pack(vector: dict[int, float]) -> list[list[float]]:
    return [[index, value] for index, value in sorted(vector.items())]


def _unpack(items: object) -> dict[int, float]:
    vector: dict[int, float] = {}
    if not isinstance(items, list):
        return vector
    for item in items:
        if isinstance(item, list) and len(item) == 2:
            vector[int(item[0])] = float(item[1])
    return vector

