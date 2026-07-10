from __future__ import annotations

from pathlib import Path

from physicscode_science.models import RepositoryConfig


def load_registry(path: str | Path) -> list[RepositoryConfig]:
    data = _parse_subset_yaml(Path(path).read_text(encoding="utf-8"))
    repositories = data.get("repositories", [])
    if not isinstance(repositories, list):
        raise ValueError("repositories.yaml must contain a repositories list")
    return [_repository_config(item) for item in repositories if isinstance(item, dict)]


def enabled_repositories(path: str | Path) -> list[RepositoryConfig]:
    return [repo for repo in load_registry(path) if repo.enabled]


def _repository_config(item: dict[str, object]) -> RepositoryConfig:
    return RepositoryConfig(
        name=_required_str(item, "name"),
        url=_required_str(item, "url"),
        local_path=_required_str(item, "local_path"),
        default_branch=_required_str(item, "default_branch"),
        revision_policy=_required_str(item, "revision_policy"),
        license_policy=_required_str(item, "license_policy"),
        domains=tuple(_string_list(item.get("domains", []))),
        languages=tuple(_string_list(item.get("languages", []))),
        priority=str(item.get("priority", "medium")),
        enabled=bool(item.get("enabled", False)),
        include_paths=tuple(_string_list(item.get("include_paths", []))),
        exclude_paths=tuple(_string_list(item.get("exclude_paths", []))),
    )


def _required_str(item: dict[str, object], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"repository entry is missing {key}")
    return value


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _parse_subset_yaml(content: str) -> dict[str, object]:
    root: dict[str, object] = {}
    current_list_name: str | None = None
    current_item: dict[str, object] | None = None
    pending_key: str | None = None

    for raw in content.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if indent == 0 and line.endswith(":"):
            current_list_name = line[:-1]
            root[current_list_name] = []
            current_item = None
            pending_key = None
            continue
        if current_list_name and indent == 2 and line.startswith("- "):
            current_item = {}
            root[current_list_name].append(current_item)  # type: ignore[union-attr]
            key, value = _split_key_value(line[2:])
            current_item[key] = _scalar(value)
            pending_key = None
            continue
        if current_item is not None and indent == 4 and line.endswith(":"):
            pending_key = line[:-1]
            current_item[pending_key] = []
            continue
        if current_item is not None and indent == 4:
            key, value = _split_key_value(line)
            current_item[key] = _scalar(value)
            pending_key = None
            continue
        if current_item is not None and pending_key and indent == 6 and line.startswith("- "):
            current_item[pending_key].append(_scalar(line[2:]))  # type: ignore[union-attr]
            continue
        raise ValueError(f"unsupported YAML subset near line: {raw}")
    return root


def _split_key_value(line: str) -> tuple[str, str]:
    if ":" not in line:
        raise ValueError(f"expected key: value in {line}")
    key, value = line.split(":", 1)
    return key.strip(), value.strip()


def _scalar(value: str) -> object:
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "":
        return ""
    return value.strip('"')
