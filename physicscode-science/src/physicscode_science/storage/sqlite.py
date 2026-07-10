from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from physicscode_science.models import ParsedObject, RepositoryRevision, SearchCandidate, SearchQuery, SourceFile


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

            create table if not exists source_file (
              repository text not null,
              commit_sha text not null,
              path text not null,
              language text not null,
              license text not null,
              license_source text not null,
              content_hash text not null,
              snapshot_path text not null,
              ingested_at text not null,
              primary key (repository, commit_sha, path)
            );

            create index if not exists source_object_repo_idx on source_object(repository);
            create index if not exists source_object_symbol_idx on source_object(symbol);
            create index if not exists source_object_hash_idx on source_object(content_hash);
            create index if not exists source_file_hash_idx on source_file(content_hash);
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

    def upsert_source_file(self, source: SourceFile, snapshot_path: str, ingested_at: datetime) -> bool:
        before = self.connection.total_changes
        self.connection.execute(
            """
            insert into source_file
              (repository, commit_sha, path, language, license, license_source,
               content_hash, snapshot_path, ingested_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(repository, commit_sha, path) do update set
              language=excluded.language,
              license=excluded.license,
              license_source=excluded.license_source,
              content_hash=excluded.content_hash,
              snapshot_path=excluded.snapshot_path,
              ingested_at=excluded.ingested_at
            where source_file.content_hash != excluded.content_hash
               or source_file.license != excluded.license
               or source_file.language != excluded.language
            """,
            (
                source.repository,
                source.commit,
                source.path,
                source.language,
                source.license.spdx_id,
                source.license.source,
                source.content_hash,
                snapshot_path,
                ingested_at.isoformat(),
            ),
        )
        return self.connection.total_changes > before

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

    def prune_objects_for_file(
        self, repository: str, commit: str, path: str, keep_object_ids: set[str]
    ) -> int:
        before = self.connection.total_changes
        if keep_object_ids:
            placeholders = ",".join("?" for _ in keep_object_ids)
            self.connection.execute(
                f"""
                delete from source_object
                where repository = ?
                  and commit_sha = ?
                  and path = ?
                  and object_id not in ({placeholders})
                """,
                (repository, commit, path, *sorted(keep_object_ids)),
            )
        else:
            self.connection.execute(
                """
                delete from source_object
                where repository = ? and commit_sha = ? and path = ?
                """,
                (repository, commit, path),
            )
        return self.connection.total_changes - before

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

    def source_file_hash(self, repository: str, commit: str, path: str) -> str | None:
        row = self.connection.execute(
            """
            select content_hash from source_file
            where repository = ? and commit_sha = ? and path = ?
            """,
            (repository, commit, path),
        ).fetchone()
        return str(row[0]) if row else None

    def search_candidates(self, query: SearchQuery) -> list[SearchCandidate]:
        conditions: list[str] = []
        values: list[str] = []
        for column, selected in (
            ("repository", query.repositories),
            ("language", query.languages),
            ("object_type", query.object_types),
            ("license", query.licenses),
        ):
            if selected:
                conditions.append(f"{column} in ({','.join('?' for _ in selected)})")
                values.extend(selected)
        where = f"where {' and '.join(conditions)}" if conditions else ""
        rows = self.connection.execute(
            f"""
            select object_id, repository, repository_url, commit_sha, path, start_line, end_line,
                   symbol, object_type, language, license, raw_content, metadata_json
            from source_object
            {where}
            """,
            tuple(values),
        ).fetchall()
        return [
            SearchCandidate(
                object_id=row["object_id"],
                repository=row["repository"],
                repository_url=row["repository_url"],
                commit=row["commit_sha"],
                path=row["path"],
                start_line=int(row["start_line"]),
                end_line=int(row["end_line"]),
                symbol=row["symbol"],
                object_type=row["object_type"],
                language=row["language"],
                license=row["license"],
                raw_content=row["raw_content"],
                metadata=json.loads(row["metadata_json"]),
            )
            for row in rows
        ]


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
