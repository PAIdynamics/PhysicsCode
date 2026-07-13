from __future__ import annotations

import json
import re
import subprocess
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

from physicscode_science.enrichment.scientific import enrich_scientific_metadata
from physicscode_science.enrichment.taxonomy import Taxonomy
from physicscode_science.enrichment.views import add_generated_views
from physicscode_science.models import (
    LicenseFinding,
    ParsedObject,
    RepositoryConfig,
    RepositoryRevision,
    SourceFile,
)
from physicscode_science.storage.content_store import ContentStore
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.utils import sha256_bytes, sha256_text

PAPER_PARSER_VERSION = "paper-chunker-v1"
PAPER_REPOSITORY_NAME = "ref-papers"
DEFAULT_CHUNK_WORDS = 900
DEFAULT_CHUNK_OVERLAP_WORDS = 120


def ingest_papers(
    papers_dir: str | Path,
    store: ScienceStore,
    report_dir: str | Path,
    *,
    content_store: ContentStore | None = None,
    taxonomy: Taxonomy | None = None,
    max_papers: int | None = None,
    chunk_words: int = DEFAULT_CHUNK_WORDS,
    chunk_overlap_words: int = DEFAULT_CHUNK_OVERLAP_WORDS,
) -> dict[str, object]:
    store.migrate()
    started_at = datetime.now(UTC)
    root = Path(papers_dir).expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"papers directory does not exist: {root}")
    repository = _repository(root)
    revision = _revision(repository, root)
    _clear_repository(store, repository.name)
    store.upsert_revision(revision, started_at)

    files = _paper_files(root)
    if max_papers is not None:
        files = files[:max_papers]

    files_changed = 0
    objects_seen = 0
    objects_changed = 0
    objects_deleted = 0
    parser_failures: list[dict[str, str]] = []

    for path in files:
        relative = path.relative_to(root).as_posix()
        try:
            text, metadata, language = _extract(path)
            if not text.strip():
                continue
            source = SourceFile(
                repository=repository.name,
                commit=revision.commit,
                path=relative,
                absolute_path=str(path),
                language=language,
                content_hash=sha256_bytes(path.read_bytes()),
                license=LicenseFinding(
                    spdx_id="NOASSERTION",
                    source="paper-ingest",
                    path=relative,
                    reference_only=True,
                ),
            )
            snapshot_path = (
                content_store.put_file(path, source.content_hash)
                if content_store
                else path
            )
            files_changed += int(store.upsert_source_file(source, str(snapshot_path), started_at))
            parsed_objects = [
                add_generated_views(enrich_scientific_metadata(parsed, taxonomy))
                for parsed in _paper_objects(
                    source,
                    revision,
                    text,
                    metadata,
                    chunk_words=chunk_words,
                    chunk_overlap_words=chunk_overlap_words,
                )
            ]
            keep_object_ids = {parsed.object_id for parsed in parsed_objects}
            for parsed in parsed_objects:
                objects_seen += 1
                objects_changed += int(store.upsert_object(parsed))
            objects_deleted += store.prune_objects_for_file(
                repository.name, revision.commit, relative, keep_object_ids
            )
        except Exception as error:  # noqa: BLE001 - ingestion reports and continues
            parser_failures.append({"path": relative, "error": str(error)})

    report = {
        "repository": repository.name,
        "url": repository.url,
        "commit": revision.commit,
        "files_considered": len(files),
        "files_changed": files_changed,
        "objects_seen": objects_seen,
        "objects_changed": objects_changed,
        "objects_deleted": objects_deleted,
        "chunk_words": chunk_words,
        "chunk_overlap_words": chunk_overlap_words,
        "parser_failures": parser_failures,
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
    }
    _write_report(report_dir, repository.name, report)
    return report


def _repository(root: Path) -> RepositoryConfig:
    return RepositoryConfig(
        name=PAPER_REPOSITORY_NAME,
        url=f"file://{root}",
        local_path=str(root),
        default_branch="snapshot",
        revision_policy="fixed-local",
        license_policy="reference-only",
        domains=(
            "plasma-physics",
            "fusion-energy",
            "gyrokinetics",
            "stellarator-optimization",
            "high-performance-computing",
        ),
        languages=("pdf", "markdown", "json", "xml"),
        priority="high",
        enabled=True,
    )


def _revision(repository: RepositoryConfig, root: Path) -> RepositoryRevision:
    digest = sha256_text(
        "\n".join(
            f"{path.relative_to(root).as_posix()}:{path.stat().st_size}:{path.stat().st_mtime_ns}"
            for path in _paper_files(root)
        )
    )
    return RepositoryRevision(
        repository=repository,
        commit=f"papers-snapshot-{digest[:24]}",
        branch=None,
        tag=None,
        dirty=False,
    )


def _paper_files(root: Path) -> list[Path]:
    suffixes = {".pdf", ".md", ".json", ".xml"}
    ignored_parts = {"source", "author-code-search"}
    files = [
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in suffixes
        and not (set(path.relative_to(root).parts) & ignored_parts)
    ]
    return sorted(files, key=lambda item: item.relative_to(root).as_posix())


def _clear_repository(store: ScienceStore, repository: str) -> None:
    rows = store.connection.execute(
        "select object_id from source_object where repository = ?",
        (repository,),
    ).fetchall()
    object_ids = [str(row["object_id"]) for row in rows]
    if object_ids:
        placeholders = ",".join("?" for _ in object_ids)
        store.connection.execute(
            f"delete from source_relationship where source_id in ({placeholders})",
            object_ids,
        )
        store.connection.execute(
            f"delete from source_relationship where target_id in ({placeholders})",
            object_ids,
        )
    store.connection.execute("delete from source_object where repository = ?", (repository,))
    store.connection.execute("delete from source_file where repository = ?", (repository,))


def _extract(path: Path) -> tuple[str, dict[str, object], str]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf(path), _metadata_from_path(path), "pdf"
    if suffix == ".json":
        return _extract_json(path), _metadata_from_path(path), "json"
    if suffix == ".xml":
        return _extract_xml(path), _metadata_from_path(path), "xml"
    return path.read_text(encoding="utf-8", errors="replace"), _metadata_from_path(path), "markdown"


def _extract_pdf(path: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-layout", "-q", str(path), "-"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return _clean_text(result.stdout)


def _extract_json(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    message = data.get("message", data) if isinstance(data, dict) else data
    if not isinstance(message, dict):
        return json.dumps(data, indent=2, sort_keys=True)
    title = _first_text(message.get("title"))
    abstract = _strip_markup(str(message.get("abstract", "")))
    authors = _authors(message.get("author"))
    container = _first_text(message.get("container-title"))
    published = message.get("published-print") or message.get("published-online") or {}
    year = ""
    if isinstance(published, dict):
        date_parts = published.get("date-parts", [])
        if date_parts and isinstance(date_parts, list) and date_parts[0]:
            year = str(date_parts[0][0])
    fields = [
        f"title: {title}",
        f"authors: {authors}",
        f"container: {container}",
        f"year: {year}",
        f"doi: {message.get('DOI', '')}",
        f"abstract: {abstract}",
        "reference_titles:",
        "\n".join(_reference_titles(message.get("reference", []))[:80]),
    ]
    return _clean_text("\n".join(item for item in fields if item.strip()))


def _extract_xml(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return _clean_text(_strip_markup(text))
    values = []
    for element in root.iter():
        tag = element.tag.split("}")[-1].lower()
        if tag in {"title", "summary", "abstract", "name", "published", "updated"} and element.text:
            values.append(f"{tag}: {element.text.strip()}")
    return _clean_text("\n".join(values) or _strip_markup(text))


def _paper_objects(
    source: SourceFile,
    revision: RepositoryRevision,
    text: str,
    metadata: dict[str, object],
    *,
    chunk_words: int,
    chunk_overlap_words: int,
) -> list[ParsedObject]:
    chunks = _chunks(text, chunk_words=chunk_words, overlap_words=chunk_overlap_words)
    title = str(metadata.get("title") or _title_from_path(source.path))
    objects = []
    for index, chunk in enumerate(chunks, start=1):
        content_hash = sha256_text(chunk)
        object_id = sha256_text(
            "|".join([source.repository, source.commit, source.path, str(index), content_hash])
        )
        objects.append(
            ParsedObject(
                object_id=f"sha256:{object_id}",
                object_type="paper-section",
                name=f"{title} chunk {index}",
                qualified_name=f"{title} :: chunk {index}",
                language=source.language,
                repository=source.repository,
                repository_url=revision.repository.url,
                commit=source.commit,
                release=None,
                path=source.path,
                start_line=index,
                end_line=index,
                signature=f"{source.path}#chunk-{index}",
                raw_content=chunk,
                documentation=str(metadata.get("abstract", "")),
                parent_symbol=title,
                dependencies=(),
                calls=(),
                called_by=(),
                tests=(),
                examples=(),
                license=source.license.spdx_id,
                copyright=(),
                content_hash=content_hash,
                ingestion_timestamp=datetime.now(UTC),
                parser_version=PAPER_PARSER_VERSION,
                metadata={
                    "domains": list(revision.repository.domains),
                    "repository_priority": revision.repository.priority,
                    "paper": metadata | {"chunk_index": index, "chunk_count": len(chunks)},
                },
            )
        )
    return objects


def _chunks(text: str, *, chunk_words: int, overlap_words: int) -> list[str]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_words = 0
    for paragraph in paragraphs:
        words = paragraph.split()
        if current and current_words + len(words) > chunk_words:
            chunks.append("\n\n".join(current))
            overlap = " ".join(" ".join(current).split()[-overlap_words:])
            current = [overlap] if overlap else []
            current_words = len(overlap.split())
        current.append(paragraph)
        current_words += len(words)
    if current:
        chunks.append("\n\n".join(current))
    return chunks or [text[: chunk_words * 6]]


def _metadata_from_path(path: Path) -> dict[str, object]:
    return {
        "title": _title_from_path(path.name),
        "source_path": str(path),
        "source_kind": path.suffix.lower().lstrip("."),
    }


def _title_from_path(path: str) -> str:
    stem = Path(path).stem
    stem = re.sub(r"^\d{4}\.\d+(?:v\d+)?-", "", stem)
    return re.sub(r"[-_]+", " ", stem).strip()


def _clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def _strip_markup(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text)


def _first_text(value: object) -> str:
    if isinstance(value, list) and value:
        return str(value[0])
    return str(value or "")


def _authors(value: object) -> str:
    if not isinstance(value, list):
        return ""
    names = []
    for item in value[:20]:
        if not isinstance(item, dict):
            continue
        names.append(" ".join(str(item.get(key, "")) for key in ("given", "family")).strip())
    return ", ".join(name for name in names if name)


def _reference_titles(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    titles = []
    for item in value:
        if isinstance(item, dict) and item.get("article-title"):
            titles.append(str(item["article-title"]))
    return titles


def _write_report(report_dir: str | Path, repository: str, report: dict[str, object]) -> None:
    path = Path(report_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{repository}.json").write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
