from __future__ import annotations

import os
import re
from urllib import error

from physicscode_science.models import SearchCandidate, SearchQuery, SearchResult
from physicscode_science.retrieval.bm25 import bm25_scores
from physicscode_science.retrieval.fusion import reciprocal_rank_fusion
from physicscode_science.retrieval.symbol import symbol_scores
from physicscode_science.retrieval.vector import hashed_vector_scores
from physicscode_science.retrieval.views import generated_view_text
from physicscode_science.reranking.cross_encoder import cross_encoder_available, rerank_candidates_cross_encoder
from physicscode_science.reranking.deduplicate import deduplicate_ranked, diversity_select
from physicscode_science.reranking.scoring import RankedCandidate, rerank_candidates
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.vector_index.local import default_vector_index_path, local_vector_scores
from physicscode_science.vector_index.qdrant import QdrantVectorIndex


def search(store: ScienceStore, query: SearchQuery) -> list[SearchResult]:
    candidates = store.search_candidates(query)
    by_id = {candidate.object_id: candidate for candidate in candidates}
    dense_scores, dense_backend = _dense_scores(store, query, candidates)
    all_channels = {
        "sparse": bm25_scores(query.query, candidates),
        "dense": dense_scores,
        "symbol": symbol_scores(query.query, candidates),
    }
    channels = {
        key: value
        for key, value in all_channels.items()
        if key in set(query.retrieval_channels)
    }
    fused, source_channels = reciprocal_rank_fusion({key: value for key, value in channels.items() if value})
    ranked_candidates = _rank(query, by_id, fused, source_channels)
    dense_requested = "dense" in set(query.retrieval_channels)
    results = [
        _result(
            item,
            source_channels[item.candidate.object_id],
            query.include_content,
            dense_backend if dense_requested else None,
        )
        for item in ranked_candidates
    ]
    results.extend(_identity_grounding_results(store, query, {result.result_id for result in results}))
    return results


def _identity_grounding_results(
    store: ScienceStore,
    query: SearchQuery,
    already_included: set[str],
) -> list[SearchResult]:
    # A compound question ("tell me about <specific topic> in <project>")
    # can have its whole evidence budget consumed by topic-specific content
    # that legitimately outranks generic project info — crowding out basic
    # "what is <project>" grounding even when the project is named right in
    # the query. Without that, the model has no retrieved fact to cite for
    # something like an acronym expansion and guesses instead. Always pin
    # the named project's own README overview alongside the ranked results.
    query_lower = query.query.lower()
    if not query_lower:
        return []
    bonus: list[SearchResult] = []
    for repository in store.distinct_repositories():
        if not re.search(rf"\b{re.escape(repository.lower())}\b", query_lower):
            continue
        candidate = store.repository_overview(repository)
        if candidate is None or candidate.object_id in already_included:
            continue
        bonus.append(
            SearchResult(
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
                score=0.0,
                retrieval_channels=("identity-grounding",),
                reason=(
                    f"Pinned: project overview for '{repository}', named directly in the query — "
                    "keeps identity facts (e.g. what an acronym stands for) grounded even when the "
                    "rest of the query is about something more specific that outranks it."
                ),
                explanation={"reranker": "identity-grounding-pin"},
                summary=_summary(candidate),
                content=candidate.raw_content if query.include_content else None,
            )
        )
    return bonus


def _rank(
    query: SearchQuery,
    by_id: dict[str, SearchCandidate],
    fused: dict[str, float],
    source_channels: dict[str, tuple[str, ...]],
) -> list[RankedCandidate]:
    if query.rerank:
        ranked = None
        if cross_encoder_available():
            ranked = rerank_candidates_cross_encoder(query.query, list(by_id.values()), fused)
        if ranked is None:
            ranked = rerank_candidates(query.query, list(by_id.values()), fused, source_channels)
            if cross_encoder_available():
                # The cross-encoder is configured but its call failed (e.g. the
                # reranker service is down) — say so instead of silently
                # reporting the heuristic reranker as if it were the intended
                # default, mirroring how _dense_scores reports its fallbacks.
                for item in ranked:
                    item.explanation["reranker"] = "deterministic-reranker-v2-fallback-cross-encoder-unavailable"
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


def _dense_scores(
    store: ScienceStore,
    query: SearchQuery,
    candidates: list[SearchCandidate],
) -> tuple[dict[str, float], str]:
    # The second element identifies what actually served this query's dense
    # channel, so a Qdrant outage or misconfiguration doesn't silently
    # downgrade search quality with no visible signal — see SearchResult
    # explanation["dense_backend"] on the caller side.
    qdrant_configured = os.environ.get("PHYSICSCODE_SCIENCE_VECTOR_BACKEND") == "qdrant"
    if qdrant_configured:
        if os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER") not in {
            "openai",
            "openai-compatible",
            "vllm",
        }:
            return {}, "qdrant_misconfigured_no_embedding_provider"
        candidate_ids = {candidate.object_id for candidate in candidates}
        try:
            scores = QdrantVectorIndex(
                os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_URL", "http://127.0.0.1:6333"),
                os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_COLLECTION", "physicscode_science_summary"),
                api_key=os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_API_KEY"),
            ).search(query.query, limit=max(query.top_k * 20, 50))
            return (
                {
                    object_id: score
                    for object_id, score in scores.items()
                    if object_id in candidate_ids
                },
                "qdrant",
            )
        except (OSError, RuntimeError, ValueError, error.URLError):
            pass
    index_path = default_vector_index_path(store)
    if index_path.exists():
        fallback = "local_json_fallback_qdrant_unavailable" if qdrant_configured else "local_json"
        return local_vector_scores(query.query, candidates, index_path), fallback
    fallback = "hash_fallback_qdrant_unavailable" if qdrant_configured else "hash"
    return hashed_vector_scores(query.query, candidates), fallback


def _result(
    ranked: RankedCandidate,
    channels: tuple[str, ...],
    include_content: bool,
    dense_backend: str | None,
) -> SearchResult:
    candidate = ranked.candidate
    explanation = dict(ranked.explanation)
    if dense_backend is not None:
        explanation["dense_backend"] = dense_backend
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
        explanation=explanation,
        summary=_summary(candidate),
        content=candidate.raw_content if include_content else None,
    )


def _reason(channels: tuple[str, ...], explanation: dict[str, object]) -> str:
    strongest = max(
        (
            ("symbol overlap", float(explanation.get("symbol_overlap", 0.0))),
            ("scientific metadata", float(explanation.get("metadata_overlap", 0.0))),
            ("generated retrieval views", float(explanation.get("generated_overlap", 0.0))),
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
