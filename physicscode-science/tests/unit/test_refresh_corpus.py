import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from physicscode_science.models import RepositoryConfig

import refresh_corpus


def _config(name: str, repo: Path) -> RepositoryConfig:
    return RepositoryConfig(
        name=name,
        url="https://example.invalid/" + name,
        local_path=str(repo),
        default_branch="main",
        revision_policy="fixed-local",
        license_policy="allowed",
        domains=("pde",),
        languages=("markdown",),
        priority="high",
        enabled=True,
    )


def _init_git_repo(repo: Path) -> None:
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, stdout=subprocess.PIPE)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test User"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "initial"], check=True, stdout=subprocess.PIPE)


def _commit(repo: Path, message: str) -> None:
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", message], check=True, stdout=subprocess.PIPE)


class ChangedRepositoryNamesTest(unittest.TestCase):
    def test_reports_only_repositories_whose_commit_moved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            unchanged_remote = root / "unchanged-remote"
            unchanged_remote.mkdir()
            (unchanged_remote / "README.md").write_text("# unchanged\n", encoding="utf-8")
            _init_git_repo(unchanged_remote)
            unchanged_clone = root / "unchanged-clone"
            subprocess.run(
                ["git", "clone", str(unchanged_remote), str(unchanged_clone)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            changed_remote = root / "changed-remote"
            changed_remote.mkdir()
            (changed_remote / "README.md").write_text("# v1\n", encoding="utf-8")
            _init_git_repo(changed_remote)
            changed_clone = root / "changed-clone"
            subprocess.run(
                ["git", "clone", str(changed_remote), str(changed_clone)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            (changed_remote / "README.md").write_text("# v2\n", encoding="utf-8")
            _commit(changed_remote, "v2")

            repositories = [
                _config("unchanged", unchanged_clone),
                _config("changed", changed_clone),
            ]
            with patch.object(refresh_corpus, "enabled_repositories", return_value=repositories):
                changed = refresh_corpus.changed_repository_names(Path("unused-registry.yaml"))

            self.assertEqual(changed, ["changed"])

    def test_a_newly_cloned_repository_counts_as_changed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote"
            remote.mkdir()
            (remote / "README.md").write_text("# v1\n", encoding="utf-8")
            _init_git_repo(remote)

            repositories = [_config("brand-new", remote.parent / "not-cloned-yet")]
            with patch.object(refresh_corpus, "enabled_repositories", return_value=repositories):
                with patch.object(refresh_corpus, "sync_repository") as mock_sync:
                    mock_sync.side_effect = [
                        {"status": "missing", "error": "local_path does not exist"},
                        {"status": "ok", "commit": "abc123"},
                    ]
                    changed = refresh_corpus.changed_repository_names(Path("unused-registry.yaml"))

            self.assertEqual(changed, ["brand-new"])


if __name__ == "__main__":
    unittest.main()
