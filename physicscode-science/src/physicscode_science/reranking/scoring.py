from __future__ import annotations

from dataclasses import dataclass

from physicscode_science.models import SearchCandidate
from physicscode_science.retrieval.tokenize import STOPWORDS, significant_terms, split_identifier, tokenize
from physicscode_science.retrieval.views import generated_view_text, scientific_metadata_text


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
    query_terms = set(significant_terms(query))
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
    generated_terms = set(tokenize(generated_view_text(candidate)))
    content_terms = set(tokenize(candidate.raw_content[:8000]))
    symbol_overlap = _overlap(query_terms, symbol_terms)
    path_overlap = _overlap(query_terms, path_terms)
    metadata_overlap = _overlap(query_terms, metadata_terms)
    generated_overlap = _overlap(query_terms, generated_terms)
    content_overlap = _overlap(query_terms, content_terms)
    channel_bonus = _channel_bonus(channels)
    exact_symbol_bonus = _exact_symbol_bonus(query_terms, candidate.symbol)
    phrase_bonus = _phrase_bonus(" ".join(sorted(query_terms)), candidate)
    score = (
        fused_score
        + 0.32 * symbol_overlap
        + 0.22 * metadata_overlap
        + 0.18 * generated_overlap
        + 0.16 * path_overlap
        + 0.1 * content_overlap
        + channel_bonus
        + exact_symbol_bonus
        + phrase_bonus
    )
    return RankedCandidate(
        candidate=candidate,
        score=score,
        explanation={
            "base_fused_score": round(fused_score, 6),
            "symbol_overlap": round(symbol_overlap, 6),
            "metadata_overlap": round(metadata_overlap, 6),
            "generated_overlap": round(generated_overlap, 6),
            "path_overlap": round(path_overlap, 6),
            "content_overlap": round(content_overlap, 6),
            "channel_bonus": round(channel_bonus, 6),
            "exact_symbol_bonus": round(exact_symbol_bonus, 6),
            "phrase_bonus": round(phrase_bonus, 6),
            "reranker": "deterministic-reranker-v2",
        },
    )


def _overlap(query_terms: set[str], candidate_terms: set[str]) -> float:
    if not query_terms or not candidate_terms:
        return 0.0
    return len(query_terms & candidate_terms) / len(query_terms)


def _channel_bonus(channels: tuple[str, ...]) -> float:
    weights = {
        "dense": 0.035,
        "sparse": 0.025,
        "symbol": 0.04,
    }
    return min(sum(weights.get(channel.split(":", 1)[0], 0.02) for channel in channels), 0.1)


def _exact_symbol_bonus(query_terms: set[str], symbol: str) -> float:
    symbol_terms = set(split_identifier(symbol))
    if not symbol_terms:
        return 0.0
    if symbol.lower() in " ".join(sorted(query_terms)):
        return 0.18
    if symbol_terms and symbol_terms <= query_terms:
        return 0.14
    return 0.0


def _phrase_bonus(query_text: str, candidate: SearchCandidate) -> float:
    haystacks = (
        candidate.symbol.lower().replace("_", " "),
        candidate.path.lower().replace("_", " ").replace("/", " "),
        generated_view_text(candidate).lower(),
    )
    for haystack in haystacks:
        if query_text and query_text in haystack:
            return 0.08
    return 0.0
