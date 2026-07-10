from __future__ import annotations

from physicscode_science.models import SearchCandidate


def generated_view_text(candidate: SearchCandidate) -> str:
    generated = candidate.metadata.get("metadata", {}).get("generated_views", {})
    if not isinstance(generated, dict):
        return ""
    queries = generated.get("queries", [])
    return " ".join(
        [
            str(generated.get("summary", "")),
            " ".join(str(query) for query in queries if isinstance(query, str)),
        ]
    )


def scientific_metadata_text(candidate: SearchCandidate) -> str:
    scientific = candidate.metadata.get("metadata", {}).get("scientific_metadata", {})
    if not isinstance(scientific, dict):
        return ""
    values: list[str] = []
    for items in scientific.values():
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                values.append(str(item.get("value", "")))
                values.extend(str(term) for term in item.get("matched_terms", []) if isinstance(term, str))
    return " ".join(values)
