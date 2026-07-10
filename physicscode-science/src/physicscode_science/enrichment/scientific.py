from __future__ import annotations

from dataclasses import replace

from physicscode_science.enrichment.taxonomy import Taxonomy
from physicscode_science.models import ParsedObject
from physicscode_science.retrieval.tokenize import tokenize

ENRICHMENT_VERSION = "scientific-keyword-v1"


def enrich_scientific_metadata(parsed: ParsedObject, taxonomy: Taxonomy | None) -> ParsedObject:
    if taxonomy is None:
        return parsed
    text = " ".join(
        [
            parsed.qualified_name,
            parsed.path,
            parsed.signature,
            parsed.documentation,
            parsed.raw_content,
            " ".join(str(item) for item in parsed.metadata.get("domains", [])),
        ]
    )
    metadata = dict(parsed.metadata)
    scientific = {
        "extractor": ENRICHMENT_VERSION,
        "provenance": "deterministic keyword match against config/taxonomy.yaml",
        "domains": _matches("domains", text, taxonomy),
        "algorithms": _matches("algorithms", text, taxonomy),
        "equations": _matches("equations", text, taxonomy),
        "parallel_models": _matches("parallel_models", text, taxonomy),
        "hardware_backends": _matches("hardware_backends", text, taxonomy),
        "numerical_properties": _matches("numerical_properties", text, taxonomy),
    }
    metadata["scientific_metadata"] = scientific
    metadata["domains"] = sorted(
        set(str(item) for item in metadata.get("domains", []))
        | {item["value"] for item in scientific["domains"]}
    )
    return replace(parsed, metadata=metadata)


def _matches(category: str, text: str, taxonomy: Taxonomy) -> list[dict[str, object]]:
    entries = taxonomy.categories.get(category, ())
    token_set = set(tokenize(text))
    lowered = text.lower()
    matches: list[dict[str, object]] = []
    for entry in entries:
        matched_terms = [
            alias
            for alias in entry.aliases
            if _alias_matches(alias, lowered, token_set)
        ]
        if matched_terms:
            matches.append(
                {
                    "value": entry.value,
                    "confidence": _confidence(entry.value, matched_terms),
                    "matched_terms": sorted(set(matched_terms)),
                    "source": ENRICHMENT_VERSION,
                }
            )
    return sorted(matches, key=lambda item: (-float(item["confidence"]), str(item["value"])))


def _alias_matches(alias: str, lowered: str, token_set: set[str]) -> bool:
    alias_tokens = tokenize(alias)
    if len(alias_tokens) <= 1:
        return alias.lower() in token_set
    return alias.lower() in lowered


def _confidence(value: str, matched_terms: list[str]) -> float:
    exact = value in matched_terms
    return 0.9 if exact else min(0.85, 0.55 + 0.1 * len(set(matched_terms)))
