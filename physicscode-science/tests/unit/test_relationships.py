import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.graph.relationships import extract_relationships
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig
from physicscode_science.parsers.basic import parse_source_file
from physicscode_science.registry.revision import resolve_revision
from physicscode_science.licensing.detect import detect_file_license, detect_repository_license
from physicscode_science.models import SourceFile
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.utils import sha256_bytes


class RelationshipTest(unittest.TestCase):
    def test_extracts_file_defines_and_call_relationships(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            source_path = repo / "solver.cpp"
            source_path.write_text(
                "int helper() {\n  return 1;\n}\n\nint solve() {\n  return helper();\n}\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            revision = resolve_revision(_config(repo))
            license_finding = detect_repository_license(repo)
            source = SourceFile(
                repository="example",
                commit=revision.commit,
                path="solver.cpp",
                absolute_path=str(source_path),
                language="cpp",
                content_hash=sha256_bytes(source_path.read_bytes()),
                license=detect_file_license(source_path, license_finding),
            )

            relationships = extract_relationships(parse_source_file(source, revision))
            relationship_types = {item.relationship_type for item in relationships}

            self.assertIn("symbol-calls-symbol", relationship_types)
            self.assertTrue(any(item.evidence == "helper" for item in relationships))

    def test_ingestion_persists_relationships(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text(
                "int helper() {\n  return 1;\n}\n\nint solve() {\n  return helper();\n}\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            store = ScienceStore(root / "science.sqlite")
            try:
                report = ingest_repository(_config(repo), store, root / "reports")
                store.commit()
                solve = store.get_symbol("solve")[0]
                relationships = store.relationships_for_object(solve.object_id)

                self.assertGreater(report["relationships"], 0)
                self.assertGreater(store.relationship_count(), 0)
                self.assertTrue(
                    any(item["relationship_type"] == "symbol-calls-symbol" for item in relationships)
                )
            finally:
                store.close()


def _repo(root: Path) -> Path:
    repo = root / "repo"
    repo.mkdir()
    (repo / "LICENSE").write_text(
        "MIT License\n\nPermission is hereby granted, free of charge\n", encoding="utf-8"
    )
    return repo


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
