import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.api.server import search_payload
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore


class ApiTest(unittest.TestCase):
    def test_search_payload_returns_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            (repo / "LICENSE").write_text(
                "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
            )
            (repo / "solver.cpp").write_text("int poisson_solver() {\n  return 0;\n}\n", encoding="utf-8")
            _init_git_repo(repo)
            db = root / "science.sqlite"
            store = ScienceStore(db)
            try:
                ingest_repository(_config(repo), store, root / "reports")
                store.commit()
            finally:
                store.close()

            payload = search_payload(str(db), {"query": "poisson solver", "top_k": 1})

            self.assertEqual(json.loads(json.dumps(payload))["results"][0]["symbol"], "poisson_solver")


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
        languages=("cpp",),
        priority="high",
        enabled=True,
    )


if __name__ == "__main__":
    unittest.main()
