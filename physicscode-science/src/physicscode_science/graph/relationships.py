from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from physicscode_science.models import ParsedObject

RELATIONSHIP_EXTRACTOR = "relationship-keyword-v1"


@dataclass(frozen=True)
class Relationship:
    source_id: str
    target_id: str
    relationship_type: str
    confidence: float
    evidence: str
    extractor: str = RELATIONSHIP_EXTRACTOR


def extract_relationships(objects: list[ParsedObject]) -> list[Relationship]:
    by_symbol = _by_symbol(objects)
    relationships: list[Relationship] = []
    relationships.extend(_file_defines(objects))
    relationships.extend(_calls(objects, by_symbol))
    relationships.extend(_includes(objects))
    relationships.extend(_docs_describe(objects, by_symbol))
    relationships.extend(_tests_and_examples(objects, by_symbol))
    return _dedupe(relationships)


def _file_defines(objects: list[ParsedObject]) -> list[Relationship]:
    files = {(item.repository, item.commit, item.path): item for item in objects if item.object_type == "file"}
    return [
        Relationship(
            source_id=file.object_id,
            target_id=item.object_id,
            relationship_type="file-defines-symbol",
            confidence=1.0,
            evidence=item.path,
        )
        for item in objects
        if item.object_type != "file" and (file := files.get((item.repository, item.commit, item.path)))
    ]


def _calls(objects: list[ParsedObject], by_symbol: dict[tuple[str, str, str], ParsedObject]) -> list[Relationship]:
    relationships: list[Relationship] = []
    for item in objects:
        for call in item.calls:
            target = by_symbol.get((item.repository, item.commit, call))
            if target and target.object_id != item.object_id:
                relationships.append(
                    Relationship(
                        source_id=item.object_id,
                        target_id=target.object_id,
                        relationship_type="symbol-calls-symbol",
                        confidence=0.8,
                        evidence=call,
                    )
                )
    return relationships


def _includes(objects: list[ParsedObject]) -> list[Relationship]:
    relationships: list[Relationship] = []
    by_name = {
        (item.repository, item.commit, Path(item.path).name): item
        for item in objects
        if item.object_type == "file"
    }
    for item in objects:
        includes = item.metadata.get("includes", [])
        if not isinstance(includes, list):
            continue
        for include in includes:
            target = by_name.get((item.repository, item.commit, Path(str(include)).name))
            if target and target.object_id != item.object_id:
                relationships.append(
                    Relationship(
                        source_id=item.object_id,
                        target_id=target.object_id,
                        relationship_type="file-includes-file",
                        confidence=0.75,
                        evidence=str(include),
                    )
                )
    return relationships


def _docs_describe(
    objects: list[ParsedObject],
    by_symbol: dict[tuple[str, str, str], ParsedObject],
) -> list[Relationship]:
    relationships: list[Relationship] = []
    for item in objects:
        if item.object_type != "documentation-section":
            continue
        text = f"{item.qualified_name} {item.raw_content}".lower()
        for key, target in by_symbol.items():
            if key[0] == item.repository and key[1] == item.commit and key[2].lower() in text:
                relationships.append(
                    Relationship(
                        source_id=item.object_id,
                        target_id=target.object_id,
                        relationship_type="documentation-describes-symbol",
                        confidence=0.7,
                        evidence=target.qualified_name,
                    )
                )
    return relationships


def _tests_and_examples(
    objects: list[ParsedObject],
    by_symbol: dict[tuple[str, str, str], ParsedObject],
) -> list[Relationship]:
    relationships: list[Relationship] = []
    for item in objects:
        path = item.path.lower()
        relationship_type = (
            "test-exercises-symbol"
            if "test" in path
            else "example-uses-symbol"
            if "example" in path or "tutorial" in path
            else ""
        )
        if not relationship_type:
            continue
        text = item.raw_content.lower()
        for key, target in by_symbol.items():
            if key[0] == item.repository and key[1] == item.commit and key[2].lower() in text:
                relationships.append(
                    Relationship(
                        source_id=item.object_id,
                        target_id=target.object_id,
                        relationship_type=relationship_type,
                        confidence=0.75,
                        evidence=target.qualified_name,
                    )
                )
    return relationships


def _by_symbol(objects: list[ParsedObject]) -> dict[tuple[str, str, str], ParsedObject]:
    return {
        (item.repository, item.commit, item.qualified_name.split("::")[-1]): item
        for item in objects
        if item.object_type in {"function", "method", "class", "build-target"}
    }


def _dedupe(relationships: list[Relationship]) -> list[Relationship]:
    seen: set[tuple[str, str, str, str]] = set()
    result: list[Relationship] = []
    for relationship in relationships:
        key = (
            relationship.source_id,
            relationship.target_id,
            relationship.relationship_type,
            relationship.evidence,
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(relationship)
    return result
