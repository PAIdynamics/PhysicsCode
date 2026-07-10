import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig
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
            subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, stdout=subprocess.PIPE)
            subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test User"], check=True)
            subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
            subprocess.run(
                ["git", "-C", str(repo), "commit", "-m", "initial"],
                check=True,
                stdout=subprocess.PIPE,
            )

            config = RepositoryConfig(
                name="example",
                url="https://example.invalid/example",
                local_path=str(repo),
                default_branch="main",
                revision_policy="fixed-local",
                license_policy="allowed",
                domains=("pde",),
                languages=("cpp",),
                priority="high",
                enabled=True,
            )
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
                self.assertEqual(store.count_objects("example"), 1)
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
