#!/usr/bin/env python3
"""Automated corpus refresh: pull every enabled reference repository to its
current upstream default branch, then incrementally re-ingest and re-embed
only the repositories whose commit actually moved.

Intended to run on a schedule (see
systemd/physicscode-science-refresh.service/.timer). For the manual/one-off
equivalent of each step, see docs/production.md.

Unlike a blind "sync everything, then re-ingest and re-embed everything"
pipeline, this only pays the (expensive - real vLLM embedding calls against
every source object) build-vector-index cost for repositories whose commit
actually moved, rather than the whole ~45-repository corpus on every run.
build-vector-index's default upsert has no internal skip-if-unchanged logic
of its own (see vector_index/qdrant.py's upsert_store), so scoping via
--repository here is what keeps a no-op day cheap.

The ingest/build-vector-index steps shell out to the same CLI commands
documented in docs/production.md, rather than re-importing their internals
directly, so this script can't drift out of sync with how those commands
actually wire up embedding config, license policy, etc.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from physicscode_science.registry.config import enabled_repositories  # noqa: E402
from physicscode_science.sync.repositories import sync_repository  # noqa: E402

CLI = [sys.executable, "-m", "physicscode_science.cli.main"]


def changed_repository_names(registry: Path) -> list[str]:
    """Pull every enabled repository to match its remote default branch,
    returning the names of repositories whose commit actually moved (newly
    cloned repositories count as changed too)."""
    changed = []
    for repository in enabled_repositories(registry):
        before = sync_repository(repository, fetch=False, clone_missing=False)
        report = sync_repository(repository, fetch=True, pull=True, clone_missing=True)
        if report["status"] != "ok":
            print(f"warning: sync failed for {repository.name}: {report.get('error')}", file=sys.stderr)
            continue
        if before["status"] != "ok" or before["commit"] != report["commit"]:
            changed.append(repository.name)
    return changed


def run(command: list[str]) -> None:
    print(f"+ {' '.join(command)}", file=sys.stderr)
    subprocess.run(command, cwd=ROOT, check=True)


def refresh(registry: Path = ROOT / "config" / "repositories.yaml") -> list[str]:
    changed = changed_repository_names(registry)
    if not changed:
        print("no repositories changed; nothing to re-ingest or re-embed")
        return changed

    print(f"changed repositories: {', '.join(changed)}")
    repo_flags = [flag for name in changed for flag in ("--repository", name)]

    run(
        [
            *CLI,
            "ingest",
            "--registry",
            "config/repositories.yaml",
            "--licenses",
            "config/licenses.yaml",
            "--taxonomy",
            "config/taxonomy.yaml",
            "--db",
            ".science/physicscode-science.sqlite",
            "--report",
            ".science/reports",
            "--content-store",
            ".science/content",
            "--stream-reports",
            *repo_flags,
        ]
    )

    api_key_file = Path(
        os.environ.get("PHYSICSCODE_SCIENCE_API_KEY_FILE", str(Path.home() / ".config/vllm/client_api_key"))
    )
    run(
        [
            *CLI,
            "build-vector-index",
            "--db",
            ".science/physicscode-science.sqlite",
            "--backend",
            "qdrant",
            "--qdrant-url",
            os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_URL", "http://127.0.0.1:6333"),
            "--qdrant-collection",
            os.environ.get("PHYSICSCODE_SCIENCE_QDRANT_COLLECTION", "physicscode_science_multiview_bge_m3_v2"),
            "--qdrant-vector-mode",
            "multi",
            "--embedding-provider",
            "vllm",
            "--embedding-url",
            os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_URL", "http://127.0.0.1:8009"),
            "--embedding-model",
            os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_MODEL", "paidynamics/bge-m3-pai"),
            "--embedding-api-key",
            api_key_file.read_text(encoding="utf-8").strip() if api_key_file.exists() else "",
            "--embedding-max-chars",
            os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_MAX_CHARS", "6000"),
            *repo_flags,
        ]
    )

    print("== corpus refresh complete ==")
    return changed


if __name__ == "__main__":
    refresh()
