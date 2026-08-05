from __future__ import annotations

import json
import os
from urllib import error, request

from physicscode_science.embeddings.providers import candidate_embedding_text
from physicscode_science.models import SearchCandidate
from physicscode_science.reranking.scoring import RankedCandidate
from physicscode_science.retrieval.tokenize import split_identifier, tokenize

# The reranker's own served max_model_len (see
# ~/.config/vllm/models/bge-reranker-v2-m3.env) is 2048 tokens shared between
# the query and each document; stay well under that in characters.
DEFAULT_MAX_DOCUMENT_CHARS = 3000

# store.search_candidates() has no LIMIT — with no repository/language/etc.
# filters it returns every object in the database (tens of thousands), and
# reciprocal_rank_fusion's `fused` dict commonly keeps most of what any
# channel touched. The heuristic reranker is cheap enough to run over all of
# that; a cross-encoder inference call is not. Only send the top candidates
# by fused (RRF) score — already a decent pre-ranking — to the cross-encoder,
# and keep the rest at the bottom, unscored by it.
DEFAULT_SHORTLIST_SIZE = 100


def cross_encoder_available() -> bool:
    return bool(os.environ.get("PHYSICSCODE_SCIENCE_RERANKER_URL"))


def rerank_candidates_cross_encoder(
    query: str,
    candidates: list[SearchCandidate],
    fused_scores: dict[str, float],
) -> list[RankedCandidate] | None:
    scored = [candidate for candidate in candidates if candidate.object_id in fused_scores]
    if not scored:
        return []
    scored.sort(key=lambda candidate: (-fused_scores[candidate.object_id], candidate.object_id))
    shortlist_size = int(os.environ.get("PHYSICSCODE_SCIENCE_RERANKER_SHORTLIST", DEFAULT_SHORTLIST_SIZE))
    shortlist = scored[:shortlist_size]
    remainder = scored[shortlist_size:]
    try:
        relevance = _score(query, shortlist)
    except (OSError, RuntimeError, ValueError, error.URLError):
        return None
    query_terms = set(tokenize(query))
    ranked = [_ranked(query_terms, candidate, relevance.get(candidate.object_id, 0.0)) for candidate in shortlist]
    ranked.extend(
        RankedCandidate(
            candidate=candidate,
            # Guaranteed below any cross-encoder-scored (>= 0) shortlist
            # result; not sent to the cross-encoder, so this is the best
            # signal available for it.
            score=fused_scores[candidate.object_id] - 1.0,
            explanation={
                "base_fused_score": round(fused_scores[candidate.object_id], 6),
                "reranker": "cross-encoder-bge-reranker-v2-m3-shortlist-overflow",
            },
        )
        for candidate in remainder
    )
    return sorted(ranked, key=lambda item: (-item.score, item.candidate.repository, item.candidate.path, item.candidate.start_line))


def _score(query: str, candidates: list[SearchCandidate]) -> dict[str, float]:
    url = os.environ["PHYSICSCODE_SCIENCE_RERANKER_URL"].rstrip("/") + "/v1/rerank"
    model = os.environ.get("PHYSICSCODE_SCIENCE_RERANKER_MODEL", "paidynamics/bge-reranker-v2-m3-pai")
    max_chars = int(os.environ.get("PHYSICSCODE_SCIENCE_RERANKER_MAX_CHARS", DEFAULT_MAX_DOCUMENT_CHARS))
    documents = [candidate_embedding_text(candidate, max_raw_chars=max_chars)[:max_chars] for candidate in candidates]
    payload = json.dumps({"model": model, "query": query, "documents": documents}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("PHYSICSCODE_SCIENCE_RERANKER_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = request.Request(url, data=payload, headers=headers, method="POST")
    timeout = float(os.environ.get("PHYSICSCODE_SCIENCE_RERANKER_TIMEOUT", "15"))
    with request.urlopen(req, timeout=timeout) as response:  # noqa: S310 - configured internal service URL
        body = json.loads(response.read().decode("utf-8"))
    scores: dict[str, float] = {}
    for item in body.get("results", []):
        index = item.get("index")
        if not isinstance(index, int) or not (0 <= index < len(candidates)):
            continue
        scores[candidates[index].object_id] = float(item.get("relevance_score", 0.0))
    return scores


def _ranked(
    query_terms: set[str],
    candidate: SearchCandidate,
    relevance_score: float,
) -> RankedCandidate:
    # relevance_score is the cross-encoder's calibrated 0..1 query/document
    # match probability — the primary signal. A small exact-symbol bonus is
    # kept on top of it: the cross-encoder sees truncated free text, not a
    # structured "the user typed this exact identifier" signal, and exact
    # identifier matches are cheap, high-precision evidence worth preserving.
    symbol_terms = set(split_identifier(candidate.symbol))
    exact_symbol_bonus = 0.05 if symbol_terms and symbol_terms <= query_terms else 0.0
    score = relevance_score + exact_symbol_bonus
    return RankedCandidate(
        candidate=candidate,
        score=score,
        explanation={
            "relevance_score": round(relevance_score, 6),
            "exact_symbol_bonus": round(exact_symbol_bonus, 6),
            "reranker": "cross-encoder-bge-reranker-v2-m3",
        },
    )
