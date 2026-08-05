from __future__ import annotations

import os
from pathlib import Path
from urllib import error, request

from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.vector_index.local import default_vector_index_path, load_local_vector_index
from physicscode_science.vector_index.qdrant import QdrantVectorIndex


def production_status(store: ScienceStore) -> dict[str, object]:
    object_count = store.count_objects()
    repositories = _repository_counts(store)

    configured_backend = "qdrant" if os.environ.get("PHYSICSCODE_SCIENCE_VECTOR_BACKEND") == "qdrant" else "local_json"
    local_artifact_status = _local_artifact_status(store)
    vector_status: dict[str, object] = {
        "configured_backend": configured_backend,
        **local_artifact_status,
    }

    if configured_backend == "qdrant":
        live_status = _live_qdrant_status()
        vector_status["live"] = live_status
        qdrant_reachable = bool(live_status.get("reachable"))
        embedding_reachable = bool(live_status.get("embedding_provider", {}).get("reachable"))
        # "ready" stays true as long as Qdrant itself is up, because sparse
        # and symbol retrieval channels don't need embeddings and still work
        # on their own — treat that as usable, not broken. dense_available is
        # the sharper signal: real semantic search specifically needs the
        # embedding provider too (see search.py's _dense_scores), and that
        # can go down independently (e.g. stopped to free GPU memory for
        # inference) without Qdrant itself being affected.
        vector_status["dense_available"] = qdrant_reachable and embedding_reachable
        ready = object_count > 0 and qdrant_reachable
    else:
        # No live backend is configured, so search falls back to the local
        # artifact above (or a deterministic-hash embedding if that's also
        # missing) — the local artifact's presence is the real readiness
        # signal in this mode.
        vector_status["dense_available"] = bool(
            local_artifact_status.get("present")
        ) and local_artifact_status.get("embedding_model", {}).get("provider") != "hash"
        ready = object_count > 0 and bool(local_artifact_status.get("present"))

    return {
        "ready": ready,
        "database": {
            "path": str(store.path),
            "object_count": object_count,
            "repositories": repositories,
        },
        "vector_index": vector_status,
    }


def _local_artifact_status(store: ScienceStore) -> dict[str, object]:
    # This describes the local vector-index.json artifact specifically. When
    # configured_backend is "qdrant" (see production_status above), real
    # queries do NOT use this artifact unless Qdrant is unreachable at query
    # time — it is only the local fallback, not necessarily what is serving
    # traffic. Check vector_index.live (present when configured_backend is
    # "qdrant") for what is actually answering queries.
    vector_path = default_vector_index_path(store)
    status: dict[str, object] = {
        "present": vector_path.exists(),
        "path": str(vector_path),
    }
    if vector_path.exists():
        index = load_local_vector_index(vector_path)
        status.update(
            {
                "backend": index["backend"],
                "object_count": index["object_count"],
                "dimensions": index["dimensions"],
                "built_at": index["built_at"],
                "embedding_model": index.get("embedding_model", {}),
            }
        )
    return status


def _live_qdrant_status() -> dict[str, object]:
    status: dict[str, object] = {"embedding_provider": _embedding_provider_status()}
    try:
        index = QdrantVectorIndex(
            os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_URL", "http://127.0.0.1:6333"),
            os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_COLLECTION", "physicscode_science_summary"),
            api_key=os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_API_KEY"),
        )
        status.update(index.collection_status())
    except (OSError, RuntimeError, ValueError) as exc:
        status.update({"reachable": False, "error": str(exc)})
    return status


def _embedding_provider_status() -> dict[str, object]:
    # Qdrant itself being reachable does not mean dense retrieval works:
    # queries still need to be embedded through PHYSICSCODE_SCIENCE_EMBEDDING_URL
    # first (see search.py's _dense_scores), and that server can be down
    # independently of Qdrant (e.g. the embedding model was stopped to free
    # GPU memory for inference). Surface that separately so it isn't hidden
    # behind a Qdrant-only reachability check.
    provider = os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER")
    url = os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_URL")
    if provider not in {"openai", "openai-compatible", "vllm"} or not url:
        return {"configured": False}
    req = request.Request(f"{url.rstrip('/')}/v1/models", method="GET")
    try:
        with request.urlopen(req, timeout=5) as response:  # noqa: S310 - configured internal service URL
            response.read()
    except (OSError, error.URLError) as exc:
        return {"configured": True, "reachable": False, "error": str(exc)}
    return {"configured": True, "reachable": True, "url": url}


def _repository_counts(store: ScienceStore) -> dict[str, int]:
    rows = store.connection.execute(
        "select repository, count(*) as count from source_object group by repository order by repository"
    ).fetchall()
    return {str(row["repository"]): int(row["count"]) for row in rows}
