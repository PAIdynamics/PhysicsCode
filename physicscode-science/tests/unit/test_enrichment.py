import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.enrichment.scientific import enrich_scientific_metadata
from physicscode_science.enrichment.taxonomy import load_taxonomy
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import LicenseFinding, ParsedObject, RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore


class EnrichmentTest(unittest.TestCase):
    def test_scientific_metadata_extracts_controlled_terms(self):
        taxonomy = load_taxonomy(Path(__file__).parents[2] / "config" / "taxonomy.yaml")
        parsed = _parsed(
            """
void deposit_charge() {
  // Kokkos parallel_for cloud-in-cell charge deposition for Vlasov-Poisson PIC.
}
"""
        )

        enriched = enrich_scientific_metadata(parsed, taxonomy)
        metadata = enriched.metadata["scientific_metadata"]

        self.assertEqual(metadata["extractor"], "scientific-keyword-v1")
        self.assertIn("particle-in-cell", enriched.metadata["domains"])
        self.assertIn("charge-deposition", _values(metadata["algorithms"]))
        self.assertIn("Vlasov-Poisson", _values(metadata["equations"]))
        self.assertIn("Kokkos", _values(metadata["parallel_models"]))
        self.assertGreater(metadata["algorithms"][0]["confidence"], 0)

    def test_ingestion_persists_scientific_metadata(self):
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
                ingest_repository(
                    _config(repo),
                    store,
                    root / "reports",
                    taxonomy=load_taxonomy(Path(__file__).parents[2] / "config" / "taxonomy.yaml"),
                )
                store.commit()
                result = store.get_symbol("deposit_charge")[0]

                scientific = result.metadata["metadata"]["scientific_metadata"]
                self.assertIn("charge-deposition", _values(scientific["algorithms"]))
            finally:
                store.close()


def _values(items: list[dict[str, object]]) -> set[str]:
    return {str(item["value"]) for item in items}


def _parsed(raw_content: str) -> ParsedObject:
    return ParsedObject(
        object_id="sha256:test",
        object_type="function",
        name="deposit_charge",
        qualified_name="deposit_charge",
        language="cpp",
        repository="example",
        repository_url="https://example.invalid/example",
        commit="abc123",
        release=None,
        path="deposit.cpp",
        start_line=1,
        end_line=3,
        signature="void deposit_charge()",
        raw_content=raw_content,
        documentation="",
        parent_symbol=None,
        dependencies=(),
        calls=(),
        called_by=(),
        tests=(),
        examples=(),
        license="MIT",
        copyright=(),
        content_hash="abc",
        ingestion_timestamp=__import__("datetime").datetime.now(__import__("datetime").UTC),
        parser_version="test",
        metadata={"domains": ["particle-in-cell"]},
    )


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
