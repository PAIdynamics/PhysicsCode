from __future__ import annotations

from dataclasses import dataclass

from physicscode_science.models import SearchCandidate
from physicscode_science.retrieval.tokenize import split_identifier, tokenize
from physicscode_science.retrieval.views import scientific_metadata_text


@dataclass(frozen=True)
class RankedCandidate:
    candidate: SearchCandidate
    score: float
    explanation: dict[str, object]


def rerank_candidates(
    query: str,
    candidates: list[SearchCandidate],
    fused_scores: dict[str, float],
    channels: dict[str, tuple[str, ...]],
) -> list[RankedCandidate]:
    query_terms = set(tokenize(query))
    ranked = [
        _rank_candidate(query_terms, candidate, fused_scores.get(candidate.object_id, 0.0), channels.get(candidate.object_id, ()))
        for candidate in candidates
        if candidate.object_id in fused_scores
    ]
    return sorted(ranked, key=lambda item: (-item.score, item.candidate.repository, item.candidate.path, item.candidate.start_line))


def _rank_candidate(
    query_terms: set[str],
    candidate: SearchCandidate,
    fused_score: float,
    channels: tuple[str, ...],
) -> RankedCandidate:
    symbol_terms = set(split_identifier(candidate.symbol))
    path_terms = set(tokenize(candidate.path))
    metadata_terms = set(tokenize(scientific_metadata_text(candidate)))
    content_terms = set(tokenize(candidate.raw_content[:4000]))
    symbol_overlap = _overlap(query_terms, symbol_terms)
    path_overlap = _overlap(query_terms, path_terms)
    metadata_overlap = _overlap(query_terms, metadata_terms)
    content_overlap = _overlap(query_terms, content_terms)
    channel_bonus = 0.03 * len(channels)
    exact_symbol_bonus = 0.15 if candidate.symbol.lower() in " ".join(sorted(query_terms)) else 0.0
    score = (
        fused_score
        + 0.34 * symbol_overlap
        + 0.2 * metadata_overlap
        + 0.18 * path_overlap
        + 0.12 * content_overlap
        + channel_bonus
        + exact_symbol_bonus
    )
    return RankedCandidate(
        candidate=candidate,
        score=score,
        explanation={
            "base_fused_score": round(fused_score, 6),
            "symbol_overlap": round(symbol_overlap, 6),
            "metadata_overlap": round(metadata_overlap, 6),
            "path_overlap": round(path_overlap, 6),
            "content_overlap": round(content_overlap, 6),
            "channel_bonus": round(channel_bonus, 6),
            "exact_symbol_bonus": round(exact_symbol_bonus, 6),
            "reranker": "deterministic-reranker-v1",
        },
    )


def _overlap(query_terms: set[str], candidate_terms: set[str]) -> float:
    if not query_terms or not candidate_terms:
        return 0.0
    return len(query_terms & candidate_terms) / len(query_terms)
