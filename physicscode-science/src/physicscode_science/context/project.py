from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from physicscode_science.ingestion.filtering import language_for

BUILD_FILES = (
    "CMakeLists.txt",
    "Makefile",
    "meson.build",
    "pyproject.toml",
    "package.json",
    "Cargo.toml",
    "fpm.toml",
    "setup.py",
)

TEST_DIR_NAMES = {"test", "tests", "unit_tests", "regression", "benchmarks"}


def inspect_project(path: str | Path, max_files: int = 5000) -> dict[str, Any]:
    root = Path(path).resolve()
    if not root.exists():
        raise FileNotFoundError(f"project path does not exist: {root}")
    files = [item for item in _iter_files(root, max_files)]
    languages = sorted({language for file in files if (language := language_for(file))})
    build_files = sorted(str(file.relative_to(root)) for file in files if file.name in BUILD_FILES)
    return {
        "path": str(root),
        "git": _git_context(root),
        "languages": languages,
        "build_files": build_files,
        "dependencies": _dependencies(root, build_files),
        "test_paths": sorted(
            str(item.relative_to(root))
            for item in root.iterdir()
            if item.is_dir() and item.name.lower() in TEST_DIR_NAMES
        ),
        "candidate_source_files": [
            str(file.relative_to(root))
            for file in files
            if language_for(file) in {"c", "cpp", "cuda", "hip", "fortran", "python"}
        ][:50],
        "file_count_scanned": len(files),
    }


def _iter_files(root: Path, max_files: int) -> list[Path]:
    files: list[Path] = []
    for file in root.rglob("*"):
        if len(files) >= max_files:
            break
        if ".git" in file.parts or not file.is_file():
            continue
        files.append(file)
    return files


def _git_context(root: Path) -> dict[str, Any]:
    return {
        "branch": _git(root, "branch", "--show-current") or None,
        "commit": _git(root, "rev-parse", "HEAD") or None,
        "dirty": bool(_git(root, "status", "--porcelain")),
        "status": _git(root, "status", "--short").splitlines(),
    }


def _dependencies(root: Path, build_files: list[str]) -> dict[str, Any]:
    dependencies: dict[str, Any] = {}
    package_json = root / "package.json"
    if "package.json" in build_files and package_json.exists():
        data = json.loads(package_json.read_text(encoding="utf-8"))
        dependencies["package_json"] = sorted(
            set(data.get("dependencies", {})) | set(data.get("devDependencies", {}))
        )
    pyproject = root / "pyproject.toml"
    if "pyproject.toml" in build_files and pyproject.exists():
        dependencies["pyproject"] = [
            line.strip()
            for line in pyproject.read_text(encoding="utf-8", errors="replace").splitlines()
            if line.strip().startswith("dependencies")
        ][:20]
    cmake = root / "CMakeLists.txt"
    if "CMakeLists.txt" in build_files and cmake.exists():
        dependencies["cmake"] = [
            line.strip()
            for line in cmake.read_text(encoding="utf-8", errors="replace").splitlines()
            if "find_package" in line or "target_link_libraries" in line
        ][:50]
    return dependencies


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else ""
