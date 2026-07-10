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
class LicensePolicy:
    allowed: tuple[str, ...]
    reference_only: tuple[str, ...]
    unknown_policy: str

    def allows(self, finding: LicenseFinding, repository_policy: str) -> bool:
        if finding.spdx_id == "NOASSERTION":
            return self.unknown_policy == "include"
        if finding.spdx_id in self.allowed:
            return True
        if finding.spdx_id in self.reference_only:
            return repository_policy == "reference-only"
        return False


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


@dataclass(frozen=True)
class SearchQuery:
    query: str
    repositories: tuple[str, ...] = ()
    languages: tuple[str, ...] = ()
    object_types: tuple[str, ...] = ()
    licenses: tuple[str, ...] = ()
    retrieval_channels: tuple[str, ...] = ("dense", "sparse", "symbol")
    top_k: int = 10
    include_content: bool = False


@dataclass(frozen=True)
class SearchCandidate:
    object_id: str
    repository: str
    repository_url: str
    commit: str
    path: str
    start_line: int
    end_line: int
    symbol: str
    object_type: str
    language: str
    license: str
    raw_content: str
    metadata: dict[str, object]


@dataclass(frozen=True)
class SearchResult:
    result_id: str
    repository: str
    repository_url: str
    commit: str
    path: str
    start_line: int
    end_line: int
    symbol: str
    object_type: str
    language: str
    license: str
    score: float
    retrieval_channels: tuple[str, ...]
    reason: str
    summary: str
    content: str | None = None


@dataclass(frozen=True)
class BenchmarkQuery:
    query_id: str
    query: str
    relevant_object_ids: tuple[str, ...] = ()
    relevant_symbols: tuple[str, ...] = ()
    relevant_repositories: tuple[str, ...] = ()
    languages: tuple[str, ...] = ()
    object_types: tuple[str, ...] = ()
    licenses: tuple[str, ...] = ()
