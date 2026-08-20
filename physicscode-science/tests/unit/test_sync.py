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

    def test_pull_advances_local_branch_to_match_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            remote = Path(directory) / "remote"
            remote.mkdir()
            (remote / "README.md").write_text("# v1\n", encoding="utf-8")
            _init_git_repo(remote)

            clone = Path(directory) / "clone"
            subprocess.run(["git", "clone", str(remote), str(clone)], check=True, stdout=subprocess.PIPE)

            # advance the remote after cloning, so the local clone is behind
            (remote / "README.md").write_text("# v2\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(remote), "add", "."], check=True)
            subprocess.run(["git", "-C", str(remote), "commit", "-m", "v2"], check=True, stdout=subprocess.PIPE)
            remote_head = subprocess.run(
                ["git", "-C", str(remote), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            report = sync_repository(_config(clone), pull=True)

            self.assertEqual(report["status"], "ok")
            self.assertIn("pulled", report["actions"])
            self.assertEqual(report["commit"], remote_head)
            self.assertEqual((clone / "README.md").read_text(encoding="utf-8"), "# v2\n")

    def test_fetch_survives_a_remote_tag_that_moved(self):
        with tempfile.TemporaryDirectory() as directory:
            remote = Path(directory) / "remote"
            remote.mkdir()
            (remote / "README.md").write_text("# v1\n", encoding="utf-8")
            _init_git_repo(remote)
            subprocess.run(["git", "-C", str(remote), "tag", "moving-tag"], check=True)

            clone = Path(directory) / "clone"
            subprocess.run(["git", "clone", str(remote), str(clone)], check=True, stdout=subprocess.PIPE)

            # advance the remote and move the tag to point at the new commit,
            # like pytorch's ciflow/* tags or spack's releases/latest do
            (remote / "README.md").write_text("# v2\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(remote), "add", "."], check=True)
            subprocess.run(["git", "-C", str(remote), "commit", "-m", "v2"], check=True, stdout=subprocess.PIPE)
            subprocess.run(["git", "-C", str(remote), "tag", "-f", "moving-tag"], check=True)

            report = sync_repository(_config(clone), fetch=True, pull=True)

            self.assertEqual(report["status"], "ok")
            self.assertIn("fetched", report["actions"])
            self.assertIn("pulled", report["actions"])

    def test_pull_discards_local_drift_to_match_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            remote = Path(directory) / "remote"
            remote.mkdir()
            (remote / "README.md").write_text("# v1\n", encoding="utf-8")
            _init_git_repo(remote)
            remote_head = subprocess.run(
                ["git", "-C", str(remote), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            clone = Path(directory) / "clone"
            subprocess.run(["git", "clone", str(remote), str(clone)], check=True, stdout=subprocess.PIPE)
            # simulate local drift: a stray commit that only exists locally
            (clone / "stray.txt").write_text("local only\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(clone), "add", "."], check=True)
            subprocess.run(["git", "-C", str(clone), "commit", "-m", "stray"], check=True, stdout=subprocess.PIPE)

            report = sync_repository(_config(clone), pull=True)

            self.assertEqual(report["status"], "ok")
            self.assertEqual(report["commit"], remote_head)
            self.assertFalse((clone / "stray.txt").exists())


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

