from __future__ import annotations

from physicscode_science.reranking.scoring import RankedCandidate


def deduplicate_ranked(items: list[RankedCandidate]) -> list[RankedCandidate]:
    seen: set[tuple[str, str, str, int]] = set()
    result: list[RankedCandidate] = []
    for item in items:
        key = (
            item.candidate.repository,
            item.candidate.commit,
            item.candidate.path,
            item.candidate.start_line // 25,
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def diversity_select(items: list[RankedCandidate], top_k: int, max_per_repository: int = 4) -> list[RankedCandidate]:
    selected: list[RankedCandidate] = []
    repo_counts: dict[str, int] = {}
    deferred: list[RankedCandidate] = []
    for item in items:
        count = repo_counts.get(item.candidate.repository, 0)
        if count < max_per_repository:
            selected.append(item)
            repo_counts[item.candidate.repository] = count + 1
        else:
            deferred.append(item)
        if len(selected) == top_k:
            return selected
    for item in deferred:
        if len(selected) == top_k:
            break
        selected.append(item)
    return selected
