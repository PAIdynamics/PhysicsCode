import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.models import RepositoryConfig
from physicscode_science.sync.repositories import sync_repository


class RepositorySyncTest(unittest.TestCase):
    def test_sync_reports_existing_repository_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            repo.mkdir()
            (repo / "README.md").write_text("# sync\n", encoding="utf-8")
            _init_git_repo(repo)

            report = sync_repository(_config(repo))

            self.assertEqual(report["status"], "ok")
            self.assertEqual(report["branch"], "main")
            self.assertFalse(report["dirty"])
            self.assertEqual(report["actions"], [])

    def test_sync_reports_missing_repository_without_clone(self):
        with tempfile.TemporaryDirectory() as directory:
            report = sync_repository(_config(Path(directory) / "missing"))

            self.assertEqual(report["status"], "missing")
            self.assertIn("clone", report["error"])


def _init_git_repo(repo: Path) -> None:
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, stdout=subprocess.PIPE)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test User"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "initial"], check=True, stdout=subprocess.PIPE)


def _config(repo: Path) -> RepositoryConfig:
    return RepositoryConfig(
        name="example",
        url="https://example.invalid/example",
        local_path=str(repo),
        default_branch="main",
        revision_policy="fixed-local",
        license_policy="allowed",
        domains=("pde",),
        languages=("markdown",),
        priority="high",
        enabled=True,
    )


if __name__ == "__main__":
    unittest.main()

