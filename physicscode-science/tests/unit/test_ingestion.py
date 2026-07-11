import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import LicensePolicy, RepositoryConfig
from physicscode_science.storage.content_store import ContentStore
from physicscode_science.storage.sqlite import ScienceStore


class IngestionTest(unittest.TestCase):
    def test_ingestion_is_idempotent_for_unchanged_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "LICENSE").write_text(
                "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
            )
            (repo / "solver.cpp").write_text("int solve_poisson() {\n  return 0;\n}\n", encoding="utf-8")
            _init_git_repo(repo)

            config = _config(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                first = ingest_repository(config, store, root / "reports")
                store.commit()
                second = ingest_repository(config, store, root / "reports")
                store.commit()

                self.assertEqual(first["objects_seen"], 1)
                self.assertEqual(first["objects_changed"], 1)
                self.assertEqual(second["objects_seen"], 1)
                self.assertEqual(second["objects_changed"], 0)
                self.assertEqual(second["files_changed"], 0)
                self.assertEqual(store.count_objects("example"), 1)
            finally:
                store.close()

    def test_changed_file_updates_only_changed_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "LICENSE").write_text(
                "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
            )
            source_path = repo / "solver.cpp"
            source_path.write_text(
                "int solve_poisson() {\n  return 0;\n}\n\nint unchanged() {\n  return 1;\n}\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            config = _config(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                first = ingest_repository(
                    config,
                    store,
                    root / "reports",
                    content_store=ContentStore(root / "content"),
                )
                store.commit()
                source_path.write_text(
                    "int solve_poisson() {\n  return 2;\n}\n\nint unchanged() {\n  return 1;\n}\n",
                    encoding="utf-8",
                )
                second = ingest_repository(
                    config,
                    store,
                    root / "reports",
                    content_store=ContentStore(root / "content"),
                )
                store.commit()

                self.assertEqual(first["objects_changed"], 2)
                self.assertEqual(second["files_changed"], 1)
                self.assertEqual(second["objects_changed"], 1)
                self.assertEqual(second["objects_deleted"], 0)
                self.assertEqual(store.count_objects("example"), 2)
                self.assertIsNotNone(store.source_file_hash("example", _head(repo), "solver.cpp"))
            finally:
                store.close()

    def test_license_policy_skips_unknown_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "solver.cpp").write_text("int solve_poisson() {\n  return 0;\n}\n", encoding="utf-8")
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                report = ingest_repository(
                    _config(repo),
                    store,
                    root / "reports",
                    license_policy=LicensePolicy(
                        allowed=("MIT",),
                        reference_only=(),
                        unknown_policy="exclude",
                    ),
                )
                store.commit()

                self.assertEqual(report["files_skipped_license"], 1)
                self.assertEqual(report["objects_seen"], 0)
                self.assertEqual(store.count_objects("example"), 0)
            finally:
                store.close()

    def test_reference_only_repository_keeps_unknown_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "solver.cpp").write_text("int solve_poisson() {\n  return 0;\n}\n", encoding="utf-8")
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                report = ingest_repository(
                    _config(repo, license_policy="reference-only"),
                    store,
                    root / "reports",
                    license_policy=LicensePolicy(
                        allowed=("MIT",),
                        reference_only=(),
                        unknown_policy="exclude",
                    ),
                )
                store.commit()

                self.assertEqual(report["files_skipped_license"], 0)
                self.assertGreater(report["objects_seen"], 0)
                self.assertGreater(store.count_objects("example"), 0)
            finally:
                store.close()


def _init_git_repo(repo: Path) -> None:
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, stdout=subprocess.PIPE)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test User"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "initial"],
        check=True,
        stdout=subprocess.PIPE,
    )


def _head(repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.strip()


def _config(repo: Path, license_policy: str = "allowed") -> RepositoryConfig:
    return RepositoryConfig(
        name="example",
        url="https://example.invalid/example",
        local_path=str(repo),
        default_branch="main",
        revision_policy="fixed-local",
        license_policy=license_policy,
        domains=("pde",),
        languages=("cpp",),
        priority="high",
        enabled=True,
    )


if __name__ == "__main__":
    unittest.main()
