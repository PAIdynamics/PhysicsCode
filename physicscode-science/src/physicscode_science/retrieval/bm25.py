from __future__ import annotations

import math
from collections import Counter

from physicscode_science.models import SearchCandidate
from physicscode_science.retrieval.tokenize import split_identifier, tokenize
from physicscode_science.retrieval.views import generated_view_text, scientific_metadata_text


def bm25_scores(query: str, candidates: list[SearchCandidate]) -> dict[str, float]:
    query_terms = tokenize(query)
    if not query_terms or not candidates:
        return {}
    documents = [_document_terms(candidate) for candidate in candidates]
    doc_frequency = Counter(term for document in documents for term in set(document))
    average_length = sum(len(document) for document in documents) / len(documents)
    k1 = 1.5
    b = 0.75
    scores: dict[str, float] = {}
    for candidate, document in zip(candidates, documents, strict=True):
        frequencies = Counter(document)
        score = 0.0
        for term in query_terms:
            if frequencies[term] == 0:
                continue
            idf = math.log(1 + (len(candidates) - doc_frequency[term] + 0.5) / (doc_frequency[term] + 0.5))
            denominator = frequencies[term] + k1 * (1 - b + b * len(document) / max(1, average_length))
            score += idf * frequencies[term] * (k1 + 1) / denominator
        if score > 0:
            scores[candidate.object_id] = score
    return scores


def _document_terms(candidate: SearchCandidate) -> list[str]:
    return (
        split_identifier(candidate.symbol)
        + tokenize(candidate.path)
        + tokenize(candidate.object_type)
        + tokenize(candidate.language)
        + tokenize(generated_view_text(candidate))
        + tokenize(scientific_metadata_text(candidate))
        + tokenize(candidate.raw_content)
    )
