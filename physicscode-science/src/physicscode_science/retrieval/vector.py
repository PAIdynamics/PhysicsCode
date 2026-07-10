from __future__ import annotations

import hashlib
import math

from physicscode_science.models import SearchCandidate
from physicscode_science.retrieval.tokenize import split_identifier, tokenize
from physicscode_science.retrieval.views import generated_view_text, scientific_metadata_text


def hashed_vector_scores(query: str, candidates: list[SearchCandidate], dimensions: int = 256) -> dict[str, float]:
    query_vector = _vector(tokenize(query), dimensions)
    if not query_vector:
        return {}
    scores: dict[str, float] = {}
    for candidate in candidates:
        score = _cosine(
            query_vector,
            _vector(
                split_identifier(candidate.symbol)
                + tokenize(candidate.path)
                + tokenize(generated_view_text(candidate))
                + tokenize(scientific_metadata_text(candidate))
                + tokenize(candidate.raw_content[:8000]),
                dimensions,
            ),
        )
        if score > 0:
            scores[candidate.object_id] = score
    return scores


def _vector(tokens: list[str], dimensions: int) -> dict[int, float]:
    vector: dict[int, float] = {}
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1 if digest[4] % 2 == 0 else -1
        vector[index] = vector.get(index, 0.0) + sign
    return vector


def _cosine(left: dict[int, float], right: dict[int, float]) -> float:
    if not left or not right:
        return 0.0
    dot = sum(value * right.get(index, 0.0) for index, value in left.items())
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, dot / (left_norm * right_norm))
