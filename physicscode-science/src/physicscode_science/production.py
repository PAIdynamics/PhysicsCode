from __future__ import annotations

from pathlib import Path

from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.vector_index.local import default_vector_index_path, load_local_vector_index


def production_status(store: ScienceStore) -> dict[str, object]:
    object_count = store.count_objects()
    repositories = _repository_counts(store)
    vector_path = default_vector_index_path(store)
    vector_status: dict[str, object] = {
        "present": vector_path.exists(),
        "path": str(vector_path),
    }
    if vector_path.exists():
        index = load_local_vector_index(vector_path)
        vector_status.update(
            {
                "backend": index["backend"],
                "object_count": index["object_count"],
                "dimensions": index["dimensions"],
                "built_at": index["built_at"],
                "embedding_model": index.get("embedding_model", {}),
            }
        )
    ready = object_count > 0 and bool(vector_status.get("present"))
    return {
        "ready": ready,
        "database": {
            "path": str(store.path),
            "object_count": object_count,
            "repositories": repositories,
        },
        "vector_index": vector_status,
    }


def _repository_counts(store: ScienceStore) -> dict[str, int]:
    rows = store.connection.execute(
        "select repository, count(*) as count from source_object group by repository order by repository"
    ).fetchall()
    return {str(row["repository"]): int(row["count"]) for row in rows}

