from __future__ import annotations

import subprocess
from datetime import UTC, datetime
from pathlib import Path

from physicscode_science.models import RepositoryConfig
from physicscode_science.registry.revision import resolve_revision
from physicscode_science.utils import try_git


def sync_repositories(
    repositories: list[RepositoryConfig],
    *,
    fetch: bool = False,
    clone_missing: bool = False,
    pull: bool = False,
) -> list[dict[str, object]]:
    return [
        sync_repository(repository, fetch=fetch, clone_missing=clone_missing, pull=pull)
        for repository in repositories
    ]


def sync_repository(
    repository: RepositoryConfig,
    *,
    fetch: bool = False,
    clone_missing: bool = False,
    pull: bool = False,
) -> dict[str, object]:
    path = Path(repository.local_path)
    report: dict[str, object] = {
        "repository": repository.name,
        "url": repository.url,
        "local_path": str(path),
        "default_branch": repository.default_branch,
        "started_at": datetime.now(UTC).isoformat(),
        "actions": [],
        "status": "ok",
    }
    try:
        if not path.exists():
            if not clone_missing:
                report["status"] = "missing"
                report["error"] = "local_path does not exist; rerun with --clone-missing to clone"
                return _finish(report)
            path.parent.mkdir(parents=True, exist_ok=True)
            _run(["git", "clone", repository.url, str(path)])
            report["actions"].append("cloned")  # type: ignore[union-attr]
        if fetch:
            # --force: some upstreams (e.g. pytorch's ciflow/* CI tags, spack's
            # releases/latest) move tags rather than only adding new ones. A
            # plain fetch refuses to update a local tag ref that would then
            # point somewhere different ("would clobber existing tag"),
            # aborting the whole sync before it even reaches the actual
            # branch pull below. These are read-only reference mirrors, so
            # always reflecting upstream's current tags is exactly what we
            # want.
            _run(["git", "-C", str(path), "fetch", "--tags", "--force", "origin"])
            report["actions"].append("fetched")  # type: ignore[union-attr]
        if pull:
            # These are read-only reference mirrors ingested for retrieval,
            # not clones anyone edits - force the local branch to exactly
            # match the fetched remote default branch (handles detached
            # HEAD, a diverged branch, or local drift uniformly) rather than
            # a merge/rebase that could fail or leave stray local commits.
            _run(["git", "-C", str(path), "fetch", "origin", repository.default_branch])
            _run(
                [
                    "git",
                    "-C",
                    str(path),
                    "checkout",
                    "-B",
                    repository.default_branch,
                    f"origin/{repository.default_branch}",
                ]
            )
            report["actions"].append("pulled")  # type: ignore[union-attr]
        revision = resolve_revision(repository)
        report.update(
            {
                "commit": revision.commit,
                "branch": revision.branch,
                "tag": revision.tag,
                "dirty": revision.dirty,
                "remote_head": _remote_head(path, repository.default_branch),
                "ahead_behind": _ahead_behind(path),
            }
        )
        return _finish(report)
    except Exception as error:  # noqa: BLE001
        report["status"] = "failed"
        report["error"] = str(error)
        return _finish(report)


def _remote_head(path: Path, branch: str) -> str | None:
    value = try_git(path, "rev-parse", f"origin/{branch}")
    return value or None


def _ahead_behind(path: Path) -> dict[str, int] | None:
    upstream = try_git(path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if not upstream:
        return None
    counts = try_git(path, "rev-list", "--left-right", "--count", f"HEAD...{upstream}")
    if not counts:
        return None
    ahead, behind = counts.split()
    return {"ahead": int(ahead), "behind": int(behind)}


def _run(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def _finish(report: dict[str, object]) -> dict[str, object]:
    report["finished_at"] = datetime.now(UTC).isoformat()
    return report

