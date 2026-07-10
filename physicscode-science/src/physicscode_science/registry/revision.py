from __future__ import annotations

from pathlib import Path

from physicscode_science.models import RepositoryConfig, RepositoryRevision
from physicscode_science.utils import run_git, try_git


def resolve_revision(repository: RepositoryConfig) -> RepositoryRevision:
    path = Path(repository.local_path)
    if not path.exists():
        raise FileNotFoundError(f"{repository.name} local_path does not exist: {path}")
    commit = run_git(path, "rev-parse", "HEAD")
    branch = run_git(path, "branch", "--show-current") or None
    tag = try_git(path, "describe", "--tags", "--exact-match", "HEAD") or None
    dirty = bool(run_git(path, "status", "--porcelain"))
    return RepositoryRevision(repository=repository, commit=commit, branch=branch, tag=tag, dirty=dirty)
