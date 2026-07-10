from __future__ import annotations

import math

from physicscode_science.models import SearchResult


def recall_at_k(results: list[SearchResult], relevant_ids: set[str], k: int) -> float:
    if not relevant_ids:
        return 0.0
    returned = {result.result_id for result in results[:k]}
    return len(returned & relevant_ids) / len(relevant_ids)


def reciprocal_rank(results: list[SearchResult], relevant_ids: set[str]) -> float:
    for index, result in enumerate(results, start=1):
        if result.result_id in relevant_ids:
            return 1 / index
    return 0.0


def ndcg_at_k(results: list[SearchResult], relevant_ids: set[str], k: int) -> float:
    if not relevant_ids:
        return 0.0
    dcg = sum(
        1 / math.log2(index + 1)
        for index, result in enumerate(results[:k], start=1)
        if result.result_id in relevant_ids
    )
    ideal_hits = min(len(relevant_ids), k)
    ideal = sum(1 / math.log2(index + 1) for index in range(1, ideal_hits + 1))
    return dcg / ideal if ideal else 0.0
