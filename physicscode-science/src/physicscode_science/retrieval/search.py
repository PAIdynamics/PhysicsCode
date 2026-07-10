from __future__ import annotations

from physicscode_science.models import SearchCandidate, SearchQuery, SearchResult
from physicscode_science.retrieval.bm25 import bm25_scores
from physicscode_science.retrieval.fusion import reciprocal_rank_fusion
from physicscode_science.retrieval.symbol import symbol_scores
from physicscode_science.retrieval.vector import hashed_vector_scores
from physicscode_science.retrieval.views import generated_view_text
from physicscode_science.reranking.deduplicate import deduplicate_ranked, diversity_select
from physicscode_science.reranking.scoring import RankedCandidate, rerank_candidates
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
    ranked_candidates = _rank(query, by_id, fused, source_channels)
    return [
        _result(item, source_channels[item.candidate.object_id], query.include_content)
        for item in ranked_candidates
    ]


def _rank(
    query: SearchQuery,
    by_id: dict[str, SearchCandidate],
    fused: dict[str, float],
    source_channels: dict[str, tuple[str, ...]],
) -> list[RankedCandidate]:
    if query.rerank:
        ranked = rerank_candidates(query.query, list(by_id.values()), fused, source_channels)
    else:
        ranked = [
            RankedCandidate(
                candidate=by_id[object_id],
                score=score,
                explanation={"base_fused_score": round(score, 6), "reranker": "disabled"},
            )
            for object_id, score in sorted(fused.items(), key=lambda item: (-item[1], item[0]))
        ]
    if query.deduplicate:
        ranked = deduplicate_ranked(ranked)
    if query.diversity:
        return diversity_select(ranked, query.top_k)
    return ranked[: query.top_k]


def _result(
    ranked: RankedCandidate,
    channels: tuple[str, ...],
    include_content: bool,
) -> SearchResult:
    candidate = ranked.candidate
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
        score=round(ranked.score, 6),
        retrieval_channels=channels,
        reason=_reason(channels, ranked.explanation),
        explanation=ranked.explanation,
        summary=_summary(candidate),
        content=candidate.raw_content if include_content else None,
    )


def _reason(channels: tuple[str, ...], explanation: dict[str, object]) -> str:
    strongest = max(
        (
            ("symbol overlap", float(explanation.get("symbol_overlap", 0.0))),
            ("scientific metadata", float(explanation.get("metadata_overlap", 0.0))),
            ("path terms", float(explanation.get("path_overlap", 0.0))),
            ("content terms", float(explanation.get("content_overlap", 0.0))),
        ),
        key=lambda item: item[1],
    )
    if strongest[1] > 0:
        return f"Matched by {', '.join(channels)} retrieval and reranked for {strongest[0]}"
    return f"Matched by {', '.join(channels)} retrieval"


def _summary(candidate: SearchCandidate) -> str:
    generated = candidate.metadata.get("metadata", {}).get("generated_views", {})
    if isinstance(generated, dict) and generated.get("summary"):
        return str(generated["summary"])
    text = " ".join(candidate.raw_content.strip().split())
    return text[:240] + ("..." if len(text) > 240 else "")
