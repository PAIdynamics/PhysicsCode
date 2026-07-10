import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.enrichment.rebuild import rebuild_metadata
from physicscode_science.enrichment.taxonomy import load_taxonomy
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore


class MetadataRebuildTest(unittest.TestCase):
    def test_rebuild_metadata_updates_stored_objects_without_reingestion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "LICENSE").write_text(
                "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
            )
            (repo / "deposit.cpp").write_text(
                "void deposit_charge() {\n  // cloud-in-cell charge deposition\n}\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                ingest_repository(_config(repo), store, root / "reports")
                store.commit()
                before = store.get_symbol("deposit_charge")[0].metadata["metadata"]

                report = rebuild_metadata(
                    store,
                    load_taxonomy(Path(__file__).parents[2] / "config" / "taxonomy.yaml"),
                )
                store.commit()
                after = store.get_symbol("deposit_charge")[0].metadata["metadata"]

                self.assertNotIn("scientific_metadata", before)
                self.assertEqual(report["objects_seen"], 1)
                self.assertEqual(report["objects_changed"], 1)
                self.assertIn("scientific_metadata", after)
                self.assertIn("charge-deposition", report["report"]["category_counts"]["algorithms"])
            finally:
                store.close()


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
        domains=("particle-in-cell",),
        languages=("cpp",),
        priority="high",
        enabled=True,
    )


if __name__ == "__main__":
    unittest.main()
