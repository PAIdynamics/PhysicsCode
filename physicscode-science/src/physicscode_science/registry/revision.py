from __future__ import annotations

import hashlib
from pathlib import Path

from physicscode_science.models import RepositoryConfig, RepositoryRevision
from physicscode_science.utils import run_git, try_git


def resolve_revision(repository: RepositoryConfig) -> RepositoryRevision:
    path = Path(repository.local_path)
    if not path.exists():
        raise FileNotFoundError(f"{repository.name} local_path does not exist: {path}")
    if not (path / ".git").exists():
        commit = _snapshot_revision(path)
        return RepositoryRevision(
            repository=repository,
            commit=commit,
            branch=None,
            tag=None,
            dirty=False,
        )
    commit = run_git(path, "rev-parse", "HEAD")
    branch = run_git(path, "branch", "--show-current") or None
    tag = try_git(path, "describe", "--tags", "--exact-match", "HEAD") or None
    dirty = bool(run_git(path, "status", "--porcelain"))
    return RepositoryRevision(repository=repository, commit=commit, branch=branch, tag=tag, dirty=dirty)


def _snapshot_revision(path: Path) -> str:
    digest = hashlib.sha256()
    for item in sorted(path.rglob("*")):
        if not item.is_file():
            continue
        relative = item.relative_to(path).as_posix()
        if "/.git/" in f"/{relative}/":
            continue
        try:
            stat = item.stat()
        except OSError:
            continue
        digest.update(relative.encode("utf-8", errors="replace"))
        digest.update(str(stat.st_size).encode("ascii"))
        digest.update(str(int(stat.st_mtime_ns)).encode("ascii"))
    return f"snapshot-{digest.hexdigest()[:24]}"
