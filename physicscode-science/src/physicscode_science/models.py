from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class RepositoryConfig:
    name: str
    url: str
    local_path: str
    default_branch: str
    revision_policy: str
    license_policy: str
    domains: tuple[str, ...]
    languages: tuple[str, ...]
    priority: str
    enabled: bool


@dataclass(frozen=True)
class RepositoryRevision:
    repository: RepositoryConfig
    commit: str
    branch: str | None
    tag: str | None
    dirty: bool


@dataclass(frozen=True)
class LicenseFinding:
    spdx_id: str
    source: str
    path: str | None = None
    copyright: tuple[str, ...] = ()
    reference_only: bool = False


@dataclass(frozen=True)
class SourceFile:
    repository: str
    commit: str
    path: str
    absolute_path: str
    language: str
    content_hash: str
    license: LicenseFinding


@dataclass(frozen=True)
class ParsedObject:
    object_id: str
    object_type: str
    name: str
    qualified_name: str
    language: str
    repository: str
    repository_url: str
    commit: str
    release: str | None
    path: str
    start_line: int
    end_line: int
    signature: str
    raw_content: str
    documentation: str
    parent_symbol: str | None
    dependencies: tuple[str, ...]
    calls: tuple[str, ...]
    called_by: tuple[str, ...]
    tests: tuple[str, ...]
    examples: tuple[str, ...]
    license: str
    copyright: tuple[str, ...]
    content_hash: str
    ingestion_timestamp: datetime
    parser_version: str
    embedding_model: str | None = None
    embedding_model_version: str | None = None
    summary_model: str | None = None
    summary_model_version: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)
