from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from physicscode_science.models import ParsedObject, RepositoryRevision


class ScienceStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row

    def close(self) -> None:
        self.connection.close()

    def migrate(self) -> None:
        self.connection.executescript(
            """
            create table if not exists repository_revision (
              name text primary key,
              url text not null,
              commit_sha text not null,
              branch text,
              tag text,
              dirty integer not null,
              revision_policy text not null,
              ingested_at text not null
            );

            create table if not exists source_object (
              object_id text primary key,
              repository text not null,
              repository_url text not null,
              commit_sha text not null,
              path text not null,
              start_line integer not null,
              end_line integer not null,
              symbol text not null,
              object_type text not null,
              language text not null,
              license text not null,
              content_hash text not null,
              parser_version text not null,
              raw_content text not null,
              metadata_json text not null,
              updated_at text not null
            );

            create index if not exists source_object_repo_idx on source_object(repository);
            create index if not exists source_object_symbol_idx on source_object(symbol);
            create index if not exists source_object_hash_idx on source_object(content_hash);
            """
        )
        self.connection.commit()

    def upsert_revision(self, revision: RepositoryRevision, ingested_at: datetime) -> None:
        self.connection.execute(
            """
            insert into repository_revision
              (name, url, commit_sha, branch, tag, dirty, revision_policy, ingested_at)
            values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(name) do update set
              url=excluded.url,
              commit_sha=excluded.commit_sha,
              branch=excluded.branch,
              tag=excluded.tag,
              dirty=excluded.dirty,
              revision_policy=excluded.revision_policy,
              ingested_at=excluded.ingested_at
            """,
            (
                revision.repository.name,
                revision.repository.url,
                revision.commit,
                revision.branch,
                revision.tag,
                int(revision.dirty),
                revision.repository.revision_policy,
                ingested_at.isoformat(),
            ),
        )

    def upsert_object(self, parsed: ParsedObject) -> bool:
        before = self.connection.total_changes
        self.connection.execute(
            """
            insert into source_object
              (object_id, repository, repository_url, commit_sha, path, start_line, end_line,
               symbol, object_type, language, license, content_hash, parser_version,
               raw_content, metadata_json, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(object_id) do update set
              content_hash=excluded.content_hash,
              raw_content=excluded.raw_content,
              metadata_json=excluded.metadata_json,
              updated_at=excluded.updated_at
            where source_object.content_hash != excluded.content_hash
            """,
            (
                parsed.object_id,
                parsed.repository,
                parsed.repository_url,
                parsed.commit,
                parsed.path,
                parsed.start_line,
                parsed.end_line,
                parsed.qualified_name,
                parsed.object_type,
                parsed.language,
                parsed.license,
                parsed.content_hash,
                parsed.parser_version,
                parsed.raw_content,
                json.dumps(_json_ready(asdict(parsed)), sort_keys=True),
                parsed.ingestion_timestamp.isoformat(),
            ),
        )
        return self.connection.total_changes > before

    def commit(self) -> None:
        self.connection.commit()

    def count_objects(self, repository: str | None = None) -> int:
        if repository is None:
            return int(self.connection.execute("select count(*) from source_object").fetchone()[0])
        return int(
            self.connection.execute(
                "select count(*) from source_object where repository = ?", (repository,)
            ).fetchone()[0]
        )


def _json_ready(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return {key: _json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    return value
