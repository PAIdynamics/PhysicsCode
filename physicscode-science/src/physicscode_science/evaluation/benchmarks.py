from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from physicscode_science.evaluation.metrics import ndcg_at_k, recall_at_k, reciprocal_rank
from physicscode_science.models import BenchmarkQuery, SearchQuery
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore

MODES: dict[str, tuple[str, ...]] = {
    "dense": ("dense",),
    "sparse": ("sparse",),
    "symbol": ("symbol",),
    "hybrid": ("dense", "sparse", "symbol"),
}


def load_benchmark_queries(path: str | Path) -> list[BenchmarkQuery]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [
        BenchmarkQuery(
            query_id=item["query_id"],
            query=item["query"],
            relevant_object_ids=tuple(item.get("relevant_object_ids", [])),
            relevant_symbols=tuple(item.get("relevant_symbols", [])),
            relevant_repositories=tuple(item.get("relevant_repositories", [])),
            domains=tuple(item.get("domains", [])),
            languages=tuple(item.get("languages", [])),
            object_types=tuple(item.get("object_types", [])),
            licenses=tuple(item.get("licenses", [])),
        )
        for item in data["queries"]
    ]


def evaluate_search(store: ScienceStore, queries: list[BenchmarkQuery], top_k: int = 10) -> dict[str, object]:
    mode_reports = {
        mode: [_evaluate_one(store, query, channels, top_k) for query in queries]
        for mode, channels in MODES.items()
    }
    return {
        "query_count": len(queries),
        "modes": {
            mode: {
                "recall_at_5": _mean(item["recall_at_5"] for item in reports),
                "recall_at_10": _mean(item["recall_at_10"] for item in reports),
                "mrr": _mean(item["reciprocal_rank"] for item in reports),
                "ndcg_at_10": _mean(item["ndcg_at_10"] for item in reports),
                "queries": reports,
            }
            for mode, reports in mode_reports.items()
        },
    }


def _evaluate_one(
    store: ScienceStore,
    benchmark: BenchmarkQuery,
    channels: tuple[str, ...],
    top_k: int,
) -> dict[str, object]:
    results = search(
        store,
        SearchQuery(
            query=benchmark.query,
            domains=benchmark.domains,
            languages=benchmark.languages,
            object_types=benchmark.object_types,
            licenses=benchmark.licenses,
            retrieval_channels=channels,
            top_k=top_k,
        ),
    )
    relevant_ids = _relevant_ids(store, benchmark)
    return {
        "query": asdict(benchmark),
        "retrieval_channels": channels,
        "result_ids": [result.result_id for result in results],
        "recall_at_5": recall_at_k(results, relevant_ids, 5),
        "recall_at_10": recall_at_k(results, relevant_ids, 10),
        "reciprocal_rank": reciprocal_rank(results, relevant_ids),
        "ndcg_at_10": ndcg_at_k(results, relevant_ids, 10),
    }


def _relevant_ids(store: ScienceStore, benchmark: BenchmarkQuery) -> set[str]:
    if benchmark.relevant_object_ids:
        return set(benchmark.relevant_object_ids)
    candidates = store.search_candidates(
        SearchQuery(
            query=benchmark.query,
            repositories=benchmark.relevant_repositories,
            domains=benchmark.domains,
            languages=benchmark.languages,
            object_types=benchmark.object_types,
            licenses=benchmark.licenses,
            top_k=1000,
        )
    )
    symbols = set(benchmark.relevant_symbols)
    repositories = set(benchmark.relevant_repositories)
    return {
        candidate.object_id
        for candidate in candidates
        if (not symbols or candidate.symbol in symbols)
        and (not repositories or candidate.repository in repositories)
    }


def _mean(values: object) -> float:
    materialized = list(values)
    if not materialized:
        return 0.0
    return round(sum(float(value) for value in materialized) / len(materialized), 6)
