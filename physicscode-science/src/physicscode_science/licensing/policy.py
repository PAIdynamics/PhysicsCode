from __future__ import annotations

from pathlib import Path

from physicscode_science.models import LicensePolicy


def load_license_policy(path: str | Path) -> LicensePolicy:
    current: str | None = None
    values: dict[str, object] = {"allowed": [], "reference_only": [], "unknown_policy": "exclude"}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if indent == 0 and line.endswith(":"):
            current = line[:-1]
            values[current] = []
            continue
        if indent == 0 and ":" in line:
            key, value = line.split(":", 1)
            values[key.strip()] = value.strip()
            current = None
            continue
        if current and indent == 2 and line.startswith("- "):
            values[current].append(line[2:].strip())  # type: ignore[union-attr]
            continue
        raise ValueError(f"unsupported license policy YAML near line: {raw}")
    return LicensePolicy(
        allowed=tuple(item for item in values["allowed"] if isinstance(item, str)),  # type: ignore[union-attr]
        reference_only=tuple(
            item for item in values["reference_only"] if isinstance(item, str)  # type: ignore[union-attr]
        ),
        unknown_policy=str(values["unknown_policy"]),
    )
