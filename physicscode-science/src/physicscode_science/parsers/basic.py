from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from physicscode_science.models import ParsedObject, RepositoryRevision, SourceFile
from physicscode_science.utils import sha256_text

PARSER_VERSION = "basic-regex-v1"
MAX_DECLARATION_LINE_CHARS = 600

PYTHON_DEF = re.compile(r"^\s*(?P<signature>(?:async\s+)?def\s+(?P<name>[A-Za-z_]\w*)\s*\([^)]*\)\s*:)")
FORTRAN_SUBPROGRAM = re.compile(
    r"^\s*(?P<signature>(?:subroutine|function)\s+(?P<name>[A-Za-z_]\w*)\b.*)", re.I
)
CMAKE_TARGET = re.compile(r"^\s*(?P<signature>(?P<name>add_(?:executable|library|test))\s*\([^)]*)", re.I)
DOC_HEADING = re.compile(r"^(?P<marks>#{1,6})\s+(?P<name>.+)$")
CALL_PATTERN = re.compile(r"\b([A-Za-z_]\w*)\s*\(")
INCLUDE_PATTERN = re.compile(r"^\s*#\s*include\s*[<\"]([^>\"]+)[>\"]")
PYTHON_IMPORT_PATTERN = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))")
IGNORED_CALLS = {
    "if",
    "for",
    "while",
    "switch",
    "return",
    "sizeof",
    "static_cast",
    "reinterpret_cast",
    "const_cast",
}


def parse_source_file(
    source: SourceFile,
    revision: RepositoryRevision,
    max_objects: int | None = None,
) -> list[ParsedObject]:
    text = Path(source.absolute_path).read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    matches = _matches_for_language(source.language, lines, limit=max_objects)
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


def _matches_for_language(
    language: str,
    lines: list[str],
    limit: int | None = None,
) -> list[dict[str, object]]:
    matcher = (
        PYTHON_DEF
        if language == "python"
        else FORTRAN_SUBPROGRAM
        if language == "fortran"
        else CMAKE_TARGET
        if language == "cmake"
        else DOC_HEADING
        if language in {"markdown", "restructuredtext"}
        else None
    )
    if matcher is None and language not in {"c", "cpp", "cuda", "hip"}:
        return []
    objects = []
    for index, line in enumerate(lines, start=1):
        if len(line) > MAX_DECLARATION_LINE_CHARS:
            continue
        if not _could_match(language, line):
            continue
        match = _cpp_function_match(line) if language in {"c", "cpp", "cuda", "hip"} else matcher.match(line)
        if match is not None:
            objects.append(
                {
                    "object_type": _object_type(language, match.group("name")),
                    "name": match.group("name").strip(),
                    "signature": match.groupdict().get("signature", line).strip(),
                    "line": index,
                }
            )
            if limit is not None and len(objects) >= limit:
                break
    return objects


class _SimpleMatch:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values

    def group(self, name: str) -> str:
        return self.values[name]

    def groupdict(self) -> dict[str, str]:
        return dict(self.values)


def _cpp_function_match(line: str) -> _SimpleMatch | None:
    stripped = line.strip()
    before_paren, _paren, after_paren = stripped.partition("(")
    if not before_paren or ")" not in after_paren:
        return None
    if any(token in before_paren for token in ("=", "[", "]")):
        return None
    before_paren = before_paren.removeprefix("template").strip()
    raw_name = before_paren.split()[-1].strip("*&")
    raw_name = raw_name.split("::")[-1] if "::" in raw_name else raw_name
    if raw_name.startswith("~"):
        raw_name = raw_name[1:]
    if not re.match(r"^[A-Za-z_]\w*$", raw_name):
        return None
    if raw_name in IGNORED_CALLS:
        return None
    signature = stripped[: stripped.find(")") + 1]
    return _SimpleMatch({"name": raw_name, "signature": signature})


def _could_match(language: str, line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if language in {"c", "cpp", "cuda", "hip"}:
        if "(" not in stripped or ")" not in stripped:
            return False
        if stripped.startswith(("#", "//", "/*", "*", "using ", "typedef ", "return ")):
            return False
        if stripped.endswith((";", ",", "\\")):
            return False
    if language == "python":
        return stripped.startswith(("def ", "async def "))
    if language == "fortran":
        return stripped.lower().startswith(("subroutine ", "function "))
    if language == "cmake":
        return stripped.lower().startswith(("add_executable", "add_library", "add_test"))
    if language in {"markdown", "restructuredtext"}:
        return stripped.startswith("#")
    return True


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
        calls=tuple(_calls(raw_content, name, source.language)),
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
            "includes": _includes(raw_content, source.language),
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


def _calls(raw_content: str, name: str, language: str) -> list[str]:
    if language not in {"c", "cpp", "cuda", "hip", "python"}:
        return []
    return sorted(
        {
            match.group(1)
            for match in CALL_PATTERN.finditer(raw_content)
            if match.group(1) not in IGNORED_CALLS and match.group(1) != name.split("::")[-1]
        }
    )


def _includes(raw_content: str, language: str) -> list[str]:
    if language in {"c", "cpp", "cuda", "hip"}:
        return [match.group(1) for match in INCLUDE_PATTERN.finditer(raw_content)]
    if language == "python":
        return [
            next(group for group in match.groups() if group)
            for match in PYTHON_IMPORT_PATTERN.finditer(raw_content)
        ]
    return []
