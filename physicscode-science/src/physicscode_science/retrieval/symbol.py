from __future__ import annotations

from physicscode_science.models import SearchCandidate
from physicscode_science.retrieval.tokenize import split_identifier, tokenize


def symbol_scores(query: str, candidates: list[SearchCandidate]) -> dict[str, float]:
    terms = set(tokenize(query))
    scores: dict[str, float] = {}
    for candidate in candidates:
        symbol_terms = set(split_identifier(candidate.symbol))
        if candidate.symbol.lower() in query.lower():
            scores[candidate.object_id] = 1.0
            continue
        overlap = terms & symbol_terms
        if overlap:
            scores[candidate.object_id] = len(overlap) / max(1, len(symbol_terms))
    return scores
