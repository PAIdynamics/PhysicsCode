from __future__ import annotations

from pathlib import Path

LANGUAGE_BY_SUFFIX = {
    ".c": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".h": "c",
    ".hh": "cpp",
    ".hpp": "cpp",
    ".hxx": "cpp",
    ".cu": "cuda",
    ".cuh": "cuda",
    ".hip": "hip",
    ".py": "python",
    ".f": "fortran",
    ".f90": "fortran",
    ".f95": "fortran",
    ".cmake": "cmake",
    ".md": "markdown",
    ".rst": "restructuredtext",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".json": "json",
    ".toml": "toml",
    ".sh": "shell",
}

EXCLUDED_DIRS = {
    ".git",
    ".github",
    ".gitlab",
    ".cache",
    "build",
    "cmake-build-debug",
    "cmake-build-release",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "third_party",
    "3rdparty",
    "externals",
    "external",
    "vendor",
    "vendored",
}

SPECIAL_NAMES = {
    "CMakeLists.txt": "cmake",
    "Dockerfile": "dockerfile",
}


def iter_indexable_files(root: str | Path, max_bytes: int = 500_000) -> list[tuple[Path, str]]:
    root_path = Path(root)
    files: list[tuple[Path, str]] = []
    for path in root_path.rglob("*"):
        if not path.is_file():
            continue
        if any(part in EXCLUDED_DIRS for part in path.relative_to(root_path).parts):
            continue
        language = language_for(path)
        if language is None:
            continue
        if path.stat().st_size > max_bytes:
            continue
        files.append((path, language))
    return sorted(files, key=lambda item: str(item[0]))


def language_for(path: str | Path) -> str | None:
    file_path = Path(path)
    if file_path.name in SPECIAL_NAMES:
        return SPECIAL_NAMES[file_path.name]
    return LANGUAGE_BY_SUFFIX.get(file_path.suffix.lower())
