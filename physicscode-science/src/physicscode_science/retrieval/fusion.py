from __future__ import annotations


def reciprocal_rank_fusion(channels: dict[str, dict[str, float]], k: int = 60) -> tuple[dict[str, float], dict[str, tuple[str, ...]]]:
    fused: dict[str, float] = {}
    source_channels: dict[str, list[str]] = {}
    for channel, scores in channels.items():
        ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
        for rank, (object_id, _score) in enumerate(ranked, start=1):
            fused[object_id] = fused.get(object_id, 0.0) + 1 / (k + rank)
            source_channels.setdefault(object_id, []).append(channel)
    return fused, {key: tuple(value) for key, value in source_channels.items()}
