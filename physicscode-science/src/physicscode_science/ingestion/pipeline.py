from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from physicscode_science.enrichment.scientific import enrich_scientific_metadata
from physicscode_science.enrichment.taxonomy import Taxonomy
from physicscode_science.enrichment.views import add_generated_views
from physicscode_science.ingestion.filtering import iter_indexable_files
from physicscode_science.licensing.detect import detect_file_license, detect_repository_license
from physicscode_science.models import LicensePolicy, RepositoryConfig, SourceFile
from physicscode_science.parsers.basic import parse_source_file
from physicscode_science.registry.revision import resolve_revision
from physicscode_science.storage.content_store import ContentStore
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.utils import sha256_bytes


def ingest_repositories(
    repositories: list[RepositoryConfig],
    store: ScienceStore,
    report_dir: str | Path,
    max_files_per_repo: int | None = None,
    license_policy: LicensePolicy | None = None,
    content_store: ContentStore | None = None,
    taxonomy: Taxonomy | None = None,
) -> list[dict[str, object]]:
    store.migrate()
    reports = [
        ingest_repository(
            repository,
            store,
            report_dir,
            max_files_per_repo=max_files_per_repo,
            license_policy=license_policy,
            content_store=content_store,
            taxonomy=taxonomy,
        )
        for repository in repositories
    ]
    store.commit()
    return reports


def ingest_repository(
    repository: RepositoryConfig,
    store: ScienceStore,
    report_dir: str | Path,
    max_files_per_repo: int | None = None,
    license_policy: LicensePolicy | None = None,
    content_store: ContentStore | None = None,
    taxonomy: Taxonomy | None = None,
) -> dict[str, object]:
    store.migrate()
    started_at = datetime.now(UTC)
    revision = resolve_revision(repository)
    repo_license = detect_repository_license(repository.local_path)
    store.upsert_revision(revision, started_at)
    files = iter_indexable_files(repository.local_path)
    selected_files = files[:max_files_per_repo] if max_files_per_repo else files
    files_changed = 0
    files_skipped_license = 0
    objects_seen = 0
    objects_changed = 0
    objects_deleted = 0
    parser_failures: list[dict[str, str]] = []

    for absolute_path, language in selected_files:
        relative_path = str(absolute_path.relative_to(repository.local_path))
        try:
            source = SourceFile(
                repository=repository.name,
                commit=revision.commit,
                path=relative_path,
                absolute_path=str(absolute_path),
                language=language,
                content_hash=sha256_bytes(absolute_path.read_bytes()),
                license=detect_file_license(absolute_path, repo_license),
            )
            if license_policy and not license_policy.allows(source.license, repository.license_policy):
                files_skipped_license += 1
                continue
            snapshot_path = (
                content_store.put_file(absolute_path, source.content_hash)
                if content_store
                else absolute_path
            )
            files_changed += int(store.upsert_source_file(source, str(snapshot_path), started_at))
            parsed_objects = [
                add_generated_views(enrich_scientific_metadata(parsed, taxonomy))
                for parsed in parse_source_file(source, revision)
            ]
            keep_object_ids = {parsed.object_id for parsed in parsed_objects}
            for parsed in parsed_objects:
                objects_seen += 1
                objects_changed += int(store.upsert_object(parsed))
            objects_deleted += store.prune_objects_for_file(
                repository.name, revision.commit, relative_path, keep_object_ids
            )
        except Exception as error:  # noqa: BLE001 - failures are reported, not hidden
            parser_failures.append({"path": relative_path, "error": str(error)})

    report = {
        "repository": repository.name,
        "url": repository.url,
        "commit": revision.commit,
        "branch": revision.branch,
        "tag": revision.tag,
        "dirty": revision.dirty,
        "revision_policy": repository.revision_policy,
        "repository_license": asdict(repo_license),
        "files_considered": len(files),
        "files_indexed": len(selected_files),
        "files_changed": files_changed,
        "files_skipped_license": files_skipped_license,
        "objects_seen": objects_seen,
        "objects_changed": objects_changed,
        "objects_deleted": objects_deleted,
        "parser_failures": parser_failures,
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
    }
    _write_report(report_dir, repository.name, report)
    return report


def _write_report(report_dir: str | Path, repository: str, report: dict[str, object]) -> None:
    path = Path(report_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{repository}.json").write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
