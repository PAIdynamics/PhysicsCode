from __future__ import annotations

from collections import Counter
from typing import Any

from physicscode_science.enrichment.scientific import enrich_scientific_metadata
from physicscode_science.enrichment.taxonomy import Taxonomy
from physicscode_science.enrichment.views import add_generated_views
from physicscode_science.models import ParsedObject
from physicscode_science.storage.sqlite import ScienceStore


def rebuild_metadata(store: ScienceStore, taxonomy: Taxonomy) -> dict[str, Any]:
    changed = 0
    objects = store.parsed_objects()
    for parsed in objects:
        enriched = add_generated_views(enrich_scientific_metadata(parsed, taxonomy))
        changed += int(store.upsert_object(enriched))
    return {
        "objects_seen": len(objects),
        "objects_changed": changed,
        "report": metadata_report(store.parsed_objects()),
    }


def metadata_report(objects: list[ParsedObject]) -> dict[str, Any]:
    category_counts: dict[str, Counter[str]] = {}
    low_confidence: list[dict[str, Any]] = []
    for parsed in objects:
        scientific = parsed.metadata.get("scientific_metadata", {})
        if not isinstance(scientific, dict):
            continue
        for category, items in scientific.items():
            if not isinstance(items, list):
                continue
            counter = category_counts.setdefault(category, Counter())
            for item in items:
                if not isinstance(item, dict) or "value" not in item:
                    continue
                counter[str(item["value"])] += 1
                confidence = float(item.get("confidence", 0.0))
                if confidence < 0.7:
                    low_confidence.append(
                        {
                            "object_id": parsed.object_id,
                            "repository": parsed.repository,
                            "path": parsed.path,
                            "symbol": parsed.qualified_name,
                            "category": category,
                            "value": item["value"],
                            "confidence": confidence,
                        }
                    )
    return {
        "object_count": len(objects),
        "category_counts": {
            category: dict(sorted(counter.items()))
            for category, counter in sorted(category_counts.items())
        },
        "low_confidence": sorted(
            low_confidence,
            key=lambda item: (float(item["confidence"]), str(item["repository"]), str(item["path"])),
        ),
    }
