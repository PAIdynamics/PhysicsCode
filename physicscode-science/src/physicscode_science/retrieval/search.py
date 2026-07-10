from __future__ import annotations

from physicscode_science.models import SearchCandidate, SearchQuery, SearchResult
from physicscode_science.retrieval.bm25 import bm25_scores
from physicscode_science.retrieval.fusion import reciprocal_rank_fusion
from physicscode_science.retrieval.symbol import symbol_scores
from physicscode_science.retrieval.vector import hashed_vector_scores
from physicscode_science.storage.sqlite import ScienceStore


def search(store: ScienceStore, query: SearchQuery) -> list[SearchResult]:
    candidates = store.search_candidates(query)
    by_id = {candidate.object_id: candidate for candidate in candidates}
    all_channels = {
        "sparse": bm25_scores(query.query, candidates),
        "dense": hashed_vector_scores(query.query, candidates),
        "symbol": symbol_scores(query.query, candidates),
    }
    channels = {
        key: value
        for key, value in all_channels.items()
        if key in set(query.retrieval_channels)
    }
    fused, source_channels = reciprocal_rank_fusion({key: value for key, value in channels.items() if value})
    ranked = sorted(fused.items(), key=lambda item: (-item[1], item[0]))[: query.top_k]
    return [
        _result(by_id[object_id], score, source_channels[object_id], query.include_content)
        for object_id, score in ranked
    ]


def _result(
    candidate: SearchCandidate,
    score: float,
    channels: tuple[str, ...],
    include_content: bool,
) -> SearchResult:
    return SearchResult(
        result_id=candidate.object_id,
        repository=candidate.repository,
        repository_url=candidate.repository_url,
        commit=candidate.commit,
        path=candidate.path,
        start_line=candidate.start_line,
        end_line=candidate.end_line,
        symbol=candidate.symbol,
        object_type=candidate.object_type,
        language=candidate.language,
        license=candidate.license,
        score=round(score, 6),
        retrieval_channels=channels,
        reason=f"Matched by {', '.join(channels)} retrieval",
        summary=_summary(candidate),
        content=candidate.raw_content if include_content else None,
    )


def _summary(candidate: SearchCandidate) -> str:
    text = " ".join(candidate.raw_content.strip().split())
    return text[:240] + ("..." if len(text) > 240 else "")
