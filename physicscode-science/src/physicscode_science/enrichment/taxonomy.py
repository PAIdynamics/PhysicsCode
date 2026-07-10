from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TaxonomyEntry:
    value: str
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class Taxonomy:
    categories: dict[str, tuple[TaxonomyEntry, ...]]


def load_taxonomy(path: str | Path) -> Taxonomy:
    categories: dict[str, list[TaxonomyEntry]] = {}
    current_category: str | None = None
    current_value: str | None = None
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if indent == 0 and line.endswith(":"):
            current_category = line[:-1]
            categories[current_category] = []
            current_value = None
            continue
        if indent == 2 and line.endswith(":") and current_category:
            current_value = line[:-1]
            categories[current_category].append(TaxonomyEntry(current_value, (current_value,)))
            continue
        if indent == 4 and current_category and current_value and line.startswith("aliases:"):
            categories[current_category][-1] = TaxonomyEntry(
                current_value,
                tuple([current_value, *_inline_list(line.removeprefix("aliases:").strip())]),
            )
            continue
        raise ValueError(f"unsupported taxonomy YAML near line: {raw}")
    return Taxonomy({key: tuple(value) for key, value in categories.items()})


def _inline_list(value: str) -> list[str]:
    if not value.startswith("[") or not value.endswith("]"):
        return []
    body = value[1:-1].strip()
    if not body:
        return []
    return [item.strip().strip('"').strip("'") for item in body.split(",")]
