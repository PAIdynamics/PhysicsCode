from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from physicscode_science.graph.relationships import Relationship
from physicscode_science.models import ParsedObject, RepositoryRevision, SearchCandidate, SearchQuery, SourceFile
from physicscode_science.retrieval.tokenize import tokenize

# Callers that genuinely want the whole matching set (index building) already
# pass a large sentinel top_k (e.g. 1_000_000) by convention — anything below
# this is a live/bounded query and gets the per-repository cap below.
UNBOUNDED_CANDIDATE_TOP_K = 100_000
# At 1.3M+ objects across 40+ repositories, a live query with no repository
# filter used to fetch every row's full raw_content in one call — that OOM
# killed the science service. Cap rows per repository instead of a flat
# LIMIT so every repository still gets fair representation in the candidate
# pool (a flat LIMIT with no ORDER BY would deterministically favor whichever
# repositories happen to sort first and never surface the rest).
DEFAULT_CANDIDATE_LIMIT_PER_REPOSITORY = 800


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

            create table if not exists source_relationship (
              source_id text not null,
              target_id text not null,
              relationship_type text not null,
              confidence real not null,
              evidence text not null,
              extractor text not null,
              updated_at text not null,
              primary key (source_id, target_id, relationship_type, evidence)
            );

            create index if not exists source_object_repo_idx on source_object(repository);
            create index if not exists source_object_symbol_idx on source_object(symbol);
            create index if not exists source_object_hash_idx on source_object(content_hash);
            create index if not exists source_file_hash_idx on source_file(content_hash);
            create index if not exists source_relationship_source_idx on source_relationship(source_id);
            create index if not exists source_relationship_target_idx on source_relationship(target_id);
            """
        )
        self._migrate_fts()
        self.connection.commit()

    def _migrate_fts(self) -> None:
        # search_candidates()'s per-repository term match used to rank every
        # row in source_object with unindexable LIKE '%term%' scans — fine at
        # a few hundred thousand rows, a full multi-minute table scan on
        # every live query once the corpus reached millions. FTS5 gives term
        # matching a real index; content='source_object' keeps the text out
        # of a second on-disk copy, with triggers below keeping it in sync
        # since upsert_object/prune_objects_for_file write to source_object
        # directly (both go through plain insert/delete, so an AFTER INSERT
        # and AFTER DELETE trigger — no AFTER UPDATE — cover every write path:
        # upsert_object's "insert or replace" resolves its conflict as a
        # delete-then-insert per SQLite's documented REPLACE semantics).
        exists = self.connection.execute(
            "select 1 from sqlite_master where type='table' and name='source_object_fts'"
        ).fetchone()
        if exists:
            return
        self.connection.executescript(
            """
            create virtual table source_object_fts using fts5(
                path, symbol, raw_content,
                content='source_object',
                content_rowid='rowid'
            );

            create trigger source_object_fts_ai after insert on source_object begin
              insert into source_object_fts(rowid, path, symbol, raw_content)
              values (new.rowid, new.path, new.symbol, new.raw_content);
            end;

            create trigger source_object_fts_ad after delete on source_object begin
              insert into source_object_fts(source_object_fts, rowid, path, symbol, raw_content)
              values ('delete', old.rowid, old.path, old.symbol, old.raw_content);
            end;
            """
        )
        self.connection.execute("insert into source_object_fts(source_object_fts) values('rebuild')")

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
        metadata = _json_ready(asdict(parsed))
        row = self.connection.execute(
            "select content_hash, metadata_json from source_object where object_id = ?",
            (parsed.object_id,),
        ).fetchone()
        if row and row["content_hash"] == parsed.content_hash:
            existing = json.loads(row["metadata_json"])
            if _semantic_payload(existing) == _semantic_payload(metadata):
                return False
        self.connection.execute(
            """
            insert or replace into source_object
              (object_id, repository, repository_url, commit_sha, path, start_line, end_line,
               symbol, object_type, language, license, content_hash, parser_version,
               raw_content, metadata_json, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                json.dumps(metadata, sort_keys=True),
                parsed.ingestion_timestamp.isoformat(),
            ),
        )
        return True

    def prune_objects_for_file(
        self, repository: str, commit: str, path: str, keep_object_ids: set[str]
    ) -> int:
        # cursor.rowcount, not connection.total_changes: the source_object_fts
        # sync triggers (see _migrate_fts) also touch rows on every delete
        # here, and total_changes counts trigger-driven writes too — a
        # before/after delta would double-count deletions once those
        # triggers exist. rowcount reflects only this statement.
        if keep_object_ids:
            placeholders = ",".join("?" for _ in keep_object_ids)
            cursor = self.connection.execute(
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
            cursor = self.connection.execute(
                """
                delete from source_object
                where repository = ? and commit_sha = ? and path = ?
                """,
                (repository, commit, path),
            )
        return cursor.rowcount

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
        if query.top_k >= UNBOUNDED_CANDIDATE_TOP_K:
            rows = self.connection.execute(
                f"""
                select object_id, repository, repository_url, commit_sha, path, start_line, end_line,
                       symbol, object_type, language, license, raw_content, metadata_json
                from source_object
                {where}
                """,
                tuple(values),
            ).fetchall()
        else:
            # An arbitrary object_id-ordered sample silently drops whatever
            # doesn't land in the first DEFAULT_CANDIDATE_LIMIT_PER_REPOSITORY
            # rows by hash order, regardless of relevance — for any
            # repository bigger than the cap (most of them now), that can
            # exclude the actual best match from ever reaching scoring.
            # Prefer objects whose path/symbol mention a query term instead,
            # falling back to object_id only as a stable tie-break. Path/
            # symbol matches (e.g. a "P3M" in the filename) are a strong,
            # precise signal, weighted above a content-only match — but
            # content matters too: a natural-language question ("what does
            # IPPL stand for") often names something (the repo/project
            # itself) that appears in a chunk's prose but not its path or
            # symbol at all (e.g. a README's untitled leading section).
            #
            # This used to score every row with unindexable LIKE '%term%'
            # scans via a single window function over the whole table — a
            # full 4M+ row scan-and-sort on every live query regardless of
            # any repository filter, since row_number() has to rank every
            # row in a partition even when most of them score 0. Splitting
            # into two phases keeps each one cheap: (1) source_object_fts
            # (see _migrate_fts) finds actual term matches via a real index,
            # so only that (typically small) matched set gets windowed; (2)
            # any repository still under DEFAULT_CANDIDATE_LIMIT_PER_REPOSITORY
            # after that is topped up with a plain indexed per-repository
            # query (source_object_repo_idx) instead of ranking the full
            # table. tokenize()'s pattern ([A-Za-z_][A-Za-z0-9_]*) can't
            # produce FTS5 query-syntax characters, so terms are safe to
            # splice into the MATCH string unescaped.
            terms = sorted({term for term in tokenize(query.query) if len(term) >= 3}, key=len, reverse=True)[:8]
            rows: list[sqlite3.Row] = []
            matched_ids_by_repo: dict[str, set[str]] = {}
            if terms:
                fts_query = " OR ".join(f'"{term}"' for term in terms)
                rows = self.connection.execute(
                    f"""
                    select object_id, repository, repository_url, commit_sha, path, start_line, end_line,
                           symbol, object_type, language, license, raw_content, metadata_json
                    from (
                        select source_object.*, row_number() over (
                            partition by repository order by fts_match.rank asc, object_id
                        ) as rn
                        from source_object
                        join (
                            select rowid, bm25(source_object_fts, 4.0, 4.0, 1.0) as rank
                            from source_object_fts
                            where source_object_fts match ?
                        ) as fts_match on fts_match.rowid = source_object.rowid
                        {where}
                    )
                    where rn <= ?
                    """,
                    (fts_query, *values, DEFAULT_CANDIDATE_LIMIT_PER_REPOSITORY),
                ).fetchall()
                for row in rows:
                    matched_ids_by_repo.setdefault(row["repository"], set()).add(row["object_id"])

            pad_repositories = query.repositories or self.distinct_repositories()
            for repository in pad_repositories:
                matched_ids = matched_ids_by_repo.get(repository, set())
                remaining = DEFAULT_CANDIDATE_LIMIT_PER_REPOSITORY - len(matched_ids)
                if remaining <= 0:
                    continue
                pad_conditions = [*conditions, "repository = ?"]
                pad_values = [*values, repository]
                if matched_ids:
                    pad_conditions.append(f"object_id not in ({','.join('?' for _ in matched_ids)})")
                    pad_values.extend(matched_ids)
                pad_where = f"where {' and '.join(pad_conditions)}"
                rows.extend(
                    self.connection.execute(
                        f"""
                        select object_id, repository, repository_url, commit_sha, path, start_line, end_line,
                               symbol, object_type, language, license, raw_content, metadata_json
                        from source_object
                        {pad_where}
                        order by object_id
                        limit ?
                        """,
                        (*pad_values, remaining),
                    ).fetchall()
                )
        candidates = [
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
        return [candidate for candidate in candidates if _domain_matches(candidate, query.domains)]

    def distinct_repositories(self) -> list[str]:
        # repository_revision has exactly one row per repository — a cheap
        # primary-key-scoped lookup, unlike a DISTINCT scan over 1M+ rows in
        # source_object.
        return [
            str(row["name"])
            for row in self.connection.execute("select name from repository_revision").fetchall()
        ]

    def repository_overview(self, repository: str) -> SearchCandidate | None:
        # The earliest chunk of a repository's top-level README — its
        # project-identity/"what is this" content, regardless of whether
        # that chunk happens to be named "Overview" (see the markdown
        # leading-section fix) or something else.
        row = self.connection.execute(
            """
            select object_id, repository, repository_url, commit_sha, path, start_line, end_line,
                   symbol, object_type, language, license, raw_content, metadata_json
            from source_object
            where repository = ? and path = 'README.md'
            order by start_line
            limit 1
            """,
            (repository,),
        ).fetchone()
        if row is None:
            return None
        return SearchCandidate(
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

    def objects_by_id(self, object_ids: list[str]) -> list[SearchCandidate]:
        # Fetch a specific, known set of objects directly — used to embed
        # exactly a delta (e.g. objects a parser fix newly recovered)
        # instead of re-embedding a whole repository to reach a handful of
        # new objects within it. Chunked for the same reason the relationship
        # delete is: SQLite's per-statement bound-parameter limit.
        candidates: list[SearchCandidate] = []
        chunk_size = 400
        for start in range(0, len(object_ids), chunk_size):
            chunk = object_ids[start : start + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            rows = self.connection.execute(
                f"""
                select object_id, repository, repository_url, commit_sha, path, start_line, end_line,
                       symbol, object_type, language, license, raw_content, metadata_json
                from source_object
                where object_id in ({placeholders})
                """,
                tuple(chunk),
            ).fetchall()
            candidates.extend(
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
            )
        return candidates

    def parsed_objects(self) -> list[ParsedObject]:
        rows = self.connection.execute(
            "select metadata_json from source_object order by repository, path, start_line"
        ).fetchall()
        return [_parsed_object_from_json(json.loads(row["metadata_json"])) for row in rows]

    def get_candidate(self, object_id: str) -> SearchCandidate | None:
        row = self.connection.execute(
            """
            select object_id, repository, repository_url, commit_sha, path, start_line, end_line,
                   symbol, object_type, language, license, raw_content, metadata_json
            from source_object
            where object_id = ?
            """,
            (object_id,),
        ).fetchone()
        if not row:
            return None
        return SearchCandidate(
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

    def get_symbol(self, symbol: str, repository: str | None = None) -> list[SearchCandidate]:
        query = SearchQuery(query=symbol, repositories=(repository,) if repository else ())
        return [candidate for candidate in self.search_candidates(query) if candidate.symbol == symbol]

    def replace_relationships_for_repository(
        self,
        repository: str,
        commit: str,
        relationships: list[Relationship],
        updated_at: datetime,
    ) -> None:
        object_ids = [
            row["object_id"]
            for row in self.connection.execute(
                "select object_id from source_object where repository = ? and commit_sha = ?",
                (repository, commit),
            ).fetchall()
        ]
        # SQLite caps bound parameters per statement (historically 999), and
        # this binds each id twice (source_id and target_id) — a repository
        # the size of dealii or Trilinos has tens of thousands of objects,
        # so a single unchunked statement here overflows that limit.
        chunk_size = 400
        for start in range(0, len(object_ids), chunk_size):
            chunk = object_ids[start : start + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            self.connection.execute(
                f"""
                delete from source_relationship
                where source_id in ({placeholders}) or target_id in ({placeholders})
                """,
                (*chunk, *chunk),
            )
        self.connection.executemany(
            """
            insert or replace into source_relationship
              (source_id, target_id, relationship_type, confidence, evidence, extractor, updated_at)
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    relationship.source_id,
                    relationship.target_id,
                    relationship.relationship_type,
                    relationship.confidence,
                    relationship.evidence,
                    relationship.extractor,
                    updated_at.isoformat(),
                )
                for relationship in relationships
            ],
        )

    def relationships_for_object(self, object_id: str, limit: int = 20) -> list[dict[str, object]]:
        rows = self.connection.execute(
            """
            select source_id, target_id, relationship_type, confidence, evidence, extractor
            from source_relationship
            where source_id = ? or target_id = ?
            order by confidence desc, relationship_type, target_id
            limit ?
            """,
            (object_id, object_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]

    def relationship_count(self) -> int:
        return int(self.connection.execute("select count(*) from source_relationship").fetchone()[0])

    def relationship_neighbors(self, object_id: str, limit: int = 20) -> list[dict[str, object]]:
        rows = self.connection.execute(
            """
            select relationship.source_id,
                   relationship.target_id,
                   relationship.relationship_type,
                   relationship.confidence,
                   relationship.evidence,
                   relationship.extractor,
                   source.symbol as source_symbol,
                   target.symbol as target_symbol,
                   source.path as source_path,
                   target.path as target_path
            from source_relationship relationship
            join source_object source on source.object_id = relationship.source_id
            join source_object target on target.object_id = relationship.target_id
            where relationship.source_id = ? or relationship.target_id = ?
            order by relationship.confidence desc, relationship.relationship_type, relationship.target_id
            limit ?
            """,
            (object_id, object_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]


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


def _semantic_payload(value: dict[str, object]) -> dict[str, object]:
    return {
        "metadata": value.get("metadata", {}),
        "summary_model": value.get("summary_model"),
        "summary_model_version": value.get("summary_model_version"),
        "embedding_model": value.get("embedding_model"),
        "embedding_model_version": value.get("embedding_model_version"),
        "parser_version": value.get("parser_version"),
    }


def _domain_matches(candidate: SearchCandidate, domains: tuple[str, ...]) -> bool:
    if not domains:
        return True
    metadata = candidate.metadata.get("metadata", {})
    if not isinstance(metadata, dict):
        return False
    candidate_domains = metadata.get("domains", [])
    if not isinstance(candidate_domains, list):
        return False
    return bool(set(domains) & set(str(domain) for domain in candidate_domains))


def _parsed_object_from_json(data: dict[str, object]) -> ParsedObject:
    return ParsedObject(
        object_id=str(data["object_id"]),
        object_type=str(data["object_type"]),
        name=str(data["name"]),
        qualified_name=str(data["qualified_name"]),
        language=str(data["language"]),
        repository=str(data["repository"]),
        repository_url=str(data["repository_url"]),
        commit=str(data["commit"]),
        release=str(data["release"]) if data.get("release") is not None else None,
        path=str(data["path"]),
        start_line=int(data["start_line"]),
        end_line=int(data["end_line"]),
        signature=str(data["signature"]),
        raw_content=str(data["raw_content"]),
        documentation=str(data["documentation"]),
        parent_symbol=str(data["parent_symbol"]) if data.get("parent_symbol") is not None else None,
        dependencies=tuple(str(item) for item in data.get("dependencies", [])),
        calls=tuple(str(item) for item in data.get("calls", [])),
        called_by=tuple(str(item) for item in data.get("called_by", [])),
        tests=tuple(str(item) for item in data.get("tests", [])),
        examples=tuple(str(item) for item in data.get("examples", [])),
        license=str(data["license"]),
        copyright=tuple(str(item) for item in data.get("copyright", [])),
        content_hash=str(data["content_hash"]),
        ingestion_timestamp=datetime.fromisoformat(str(data["ingestion_timestamp"])),
        parser_version=str(data["parser_version"]),
        embedding_model=str(data["embedding_model"]) if data.get("embedding_model") is not None else None,
        embedding_model_version=str(data["embedding_model_version"])
        if data.get("embedding_model_version") is not None
        else None,
        summary_model=str(data["summary_model"]) if data.get("summary_model") is not None else None,
        summary_model_version=str(data["summary_model_version"])
        if data.get("summary_model_version") is not None
        else None,
        metadata=dict(data.get("metadata", {})),
    )
