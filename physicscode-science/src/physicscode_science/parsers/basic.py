from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from physicscode_science.models import ParsedObject, RepositoryRevision, SourceFile
from physicscode_science.utils import sha256_text

PARSER_VERSION = "basic-regex-v1"

CPP_FUNCTION = re.compile(
    r"^\s*(?:template\s*<[^;{}]+>\s*)?(?P<signature>(?:[\w:<>,~*&\s]+\s+)+(?P<name>[A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?)\{?"
)
PYTHON_DEF = re.compile(r"^\s*(?P<signature>(?:async\s+)?def\s+(?P<name>[A-Za-z_]\w*)\s*\([^)]*\)\s*:)")
FORTRAN_SUBPROGRAM = re.compile(
    r"^\s*(?P<signature>(?:subroutine|function)\s+(?P<name>[A-Za-z_]\w*)\b.*)", re.I
)
CMAKE_TARGET = re.compile(r"^\s*(?P<signature>(?P<name>add_(?:executable|library|test))\s*\([^)]*)", re.I)
DOC_HEADING = re.compile(r"^(?P<marks>#{1,6})\s+(?P<name>.+)$")


def parse_source_file(source: SourceFile, revision: RepositoryRevision) -> list[ParsedObject]:
    text = Path(source.absolute_path).read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    matches = _matches_for_language(source.language, lines)
    if not matches:
        return [_file_object(source, revision, text, lines)]
    return [
        _parsed_object(
            source=source,
            revision=revision,
            object_type=match["object_type"],
            name=match["name"],
            signature=match["signature"],
            lines=lines,
            start_line=match["line"],
            end_line=_end_line(lines, match["line"], source.language),
            parent_symbol=None,
        )
        for match in matches
    ]


def _matches_for_language(language: str, lines: list[str]) -> list[dict[str, object]]:
    matcher = (
        PYTHON_DEF
        if language == "python"
        else FORTRAN_SUBPROGRAM
        if language == "fortran"
        else CMAKE_TARGET
        if language == "cmake"
        else DOC_HEADING
        if language in {"markdown", "restructuredtext"}
        else CPP_FUNCTION
        if language in {"c", "cpp", "cuda", "hip"}
        else None
    )
    if matcher is None:
        return []
    objects = []
    for index, line in enumerate(lines, start=1):
        match = matcher.match(line)
        if match:
            objects.append(
                {
                    "object_type": _object_type(language, match.group("name")),
                    "name": match.group("name").strip(),
                    "signature": match.groupdict().get("signature", line).strip(),
                    "line": index,
                }
            )
    return objects


def _object_type(language: str, name: str) -> str:
    if language in {"markdown", "restructuredtext"}:
        return "documentation-section"
    if language == "cmake":
        return "build-target"
    if name.startswith("add_test"):
        return "test"
    return "function"


def _end_line(lines: list[str], start_line: int, language: str) -> int:
    if language in {"markdown", "restructuredtext"}:
        for index in range(start_line, len(lines)):
            if DOC_HEADING.match(lines[index]):
                return index
        return len(lines)
    brace_balance = 0
    saw_brace = False
    for index in range(start_line - 1, min(len(lines), start_line + 240)):
        brace_balance += lines[index].count("{") - lines[index].count("}")
        saw_brace = saw_brace or "{" in lines[index]
        if saw_brace and brace_balance <= 0:
            return index + 1
        if language in {"python", "fortran", "cmake"} and index > start_line + 40:
            return index + 1
    return min(len(lines), start_line + 80)


def _file_object(source: SourceFile, revision: RepositoryRevision, text: str, lines: list[str]) -> ParsedObject:
    return _parsed_object(
        source=source,
        revision=revision,
        object_type="file",
        name=Path(source.path).name,
        signature=source.path,
        lines=lines,
        start_line=1,
        end_line=max(1, len(lines)),
        parent_symbol=None,
    )


def _parsed_object(
    source: SourceFile,
    revision: RepositoryRevision,
    object_type: str,
    name: str,
    signature: str,
    lines: list[str],
    start_line: int,
    end_line: int,
    parent_symbol: str | None,
) -> ParsedObject:
    raw_content = "\n".join(lines[start_line - 1 : end_line])
    content_hash = sha256_text(raw_content)
    object_id = sha256_text(
        "|".join([source.repository, source.commit, source.path, str(start_line), str(end_line), name])
    )
    return ParsedObject(
        object_id=f"sha256:{object_id}",
        object_type=object_type,
        name=name,
        qualified_name=name,
        language=source.language,
        repository=source.repository,
        repository_url=revision.repository.url,
        commit=source.commit,
        release=revision.tag,
        path=source.path,
        start_line=start_line,
        end_line=end_line,
        signature=signature,
        raw_content=raw_content,
        documentation=_leading_comment(lines, start_line),
        parent_symbol=parent_symbol,
        dependencies=(),
        calls=(),
        called_by=(),
        tests=(),
        examples=(),
        license=source.license.spdx_id,
        copyright=source.license.copyright,
        content_hash=content_hash,
        ingestion_timestamp=datetime.now(UTC),
        parser_version=PARSER_VERSION,
        metadata={
            "domains": list(revision.repository.domains),
            "repository_priority": revision.repository.priority,
        },
    )


def _leading_comment(lines: list[str], start_line: int) -> str:
    comments: list[str] = []
    for line in reversed(lines[max(0, start_line - 8) : start_line - 1]):
        stripped = line.strip()
        if stripped.startswith(("//", "#", "*", "!")):
            comments.append(stripped.lstrip("/#*! "))
            continue
        if stripped == "":
            continue
        break
    return "\n".join(reversed(comments))
