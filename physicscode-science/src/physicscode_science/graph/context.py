from __future__ import annotations

from dataclasses import asdict
from typing import Any

from physicscode_science.models import SearchResult
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore

RELATIONSHIP_PRIORITY = {
    "symbol-calls-symbol": 1,
    "test-exercises-symbol": 2,
    "example-uses-symbol": 3,
    "documentation-describes-symbol": 4,
    "file-defines-symbol": 5,
    "file-includes-file": 6,
}


def get_context(
    store: ScienceStore,
    query: str,
    top_k: int = 5,
    max_chars: int = 6000,
) -> dict[str, Any]:
    from physicscode_science.models import SearchQuery

    results = search(store, SearchQuery(query=query, top_k=top_k, include_content=False))
    remaining = max_chars
    context: list[dict[str, Any]] = []
    omitted = {"results_budget": 0, "related_budget": 0}
    for result in results:
        item = _base_context(result, summary_chars=360)
        cost = _cost(item)
        if cost > remaining:
            omitted["results_budget"] += 1
            break
        remaining -= cost
        related = _related(store, result, remaining)
        item["related"] = related["items"]
        remaining = related["remaining"]
        omitted["related_budget"] += related["omitted_budget"]
        context.append(item)
    return {
        "query": query,
        "max_chars": max_chars,
        "used_chars": max_chars - remaining,
        "remaining_chars": remaining,
        "omitted": omitted,
        "context": context,
    }


def _base_context(result: SearchResult, summary_chars: int) -> dict[str, Any]:
    result_payload = asdict(result) | {"content": None}
    result_payload["summary"] = _compress_text(str(result_payload["summary"]), summary_chars)
    return {
        "result": result_payload,
        "provenance": {
            "repository": result.repository,
            "repository_url": result.repository_url,
            "commit": result.commit,
            "path": result.path,
            "line_range": [result.start_line, result.end_line],
            "license": result.license,
        },
    }


def _related(store: ScienceStore, result: SearchResult, remaining: int) -> dict[str, Any]:
    related: list[dict[str, Any]] = []
    omitted_budget = 0
    relationships = sorted(
        store.relationship_neighbors(result.result_id, limit=20),
        key=lambda item: (
            RELATIONSHIP_PRIORITY.get(str(item["relationship_type"]), 99),
            -float(item["confidence"]),
        ),
    )
    for relationship in relationships:
        neighbor_id = (
            str(relationship["target_id"])
            if relationship["source_id"] == result.result_id
            else str(relationship["source_id"])
        )
        candidate = store.get_candidate(neighbor_id)
        if not candidate:
            continue
        item = {
            "relationship_type": relationship["relationship_type"],
            "confidence": relationship["confidence"],
            "evidence": relationship["evidence"],
            "direction": "outgoing" if relationship["source_id"] == result.result_id else "incoming",
            "object": {
                "object_id": candidate.object_id,
                "repository": candidate.repository,
                "commit": candidate.commit,
                "path": candidate.path,
                "line_range": [candidate.start_line, candidate.end_line],
                "symbol": candidate.symbol,
                "object_type": candidate.object_type,
                "language": candidate.language,
                "license": candidate.license,
                "summary": _compress_text(_candidate_summary(candidate), 260),
            },
        }
        cost = _cost(item)
        if cost > remaining:
            omitted_budget += 1
            continue
        related.append(item)
        remaining -= cost
    return {"items": related, "remaining": remaining, "omitted_budget": omitted_budget}


def _candidate_summary(candidate: Any) -> str:
    generated = candidate.metadata.get("metadata", {}).get("generated_views", {})
    if isinstance(generated, dict) and generated.get("summary"):
        return str(generated["summary"])
    text = " ".join(candidate.raw_content.strip().split())
    return text[:240] + ("..." if len(text) > 240 else "")


def _compress_text(text: str, max_chars: int) -> str:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return compact
    return compact[: max(0, max_chars - 3)].rstrip() + "..."


def _cost(value: object) -> int:
    return len(str(value))
