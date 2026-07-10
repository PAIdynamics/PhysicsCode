import tempfile
import unittest
from pathlib import Path

from physicscode_science.models import LicenseFinding, RepositoryConfig, RepositoryRevision, SourceFile
from physicscode_science.parsers.basic import parse_source_file
from physicscode_science.utils import sha256_bytes


class ParserTest(unittest.TestCase):
    def test_parse_cpp_function_with_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "deposit.cpp"
            source_path.write_text(
                """
// Deposits charge on a mesh.
void deposit_charge(int n) {
  for (int i = 0; i < n; ++i) {}
}
""",
                encoding="utf-8",
            )
            source = SourceFile(
                repository="pic",
                commit="abc123",
                path="src/deposit.cpp",
                absolute_path=str(source_path),
                language="cpp",
                content_hash=sha256_bytes(source_path.read_bytes()),
                license=LicenseFinding("BSD-3-Clause", "repository"),
            )
            revision = RepositoryRevision(
                repository=RepositoryConfig(
                    name="pic",
                    url="https://example.invalid/pic",
                    local_path=str(root),
                    default_branch="main",
                    revision_policy="fixed-local",
                    license_policy="allowed",
                    domains=("particle-in-cell",),
                    languages=("cpp",),
                    priority="high",
                    enabled=True,
                ),
                commit="abc123",
                branch="main",
                tag=None,
                dirty=False,
            )

            objects = parse_source_file(source, revision)

            self.assertEqual(len(objects), 1)
            self.assertEqual(objects[0].name, "deposit_charge")
            self.assertEqual(objects[0].repository, "pic")
            self.assertEqual(objects[0].commit, "abc123")
            self.assertEqual(objects[0].start_line, 3)
            self.assertEqual(objects[0].license, "BSD-3-Clause")
            self.assertEqual(objects[0].documentation, "Deposits charge on a mesh.")


if __name__ == "__main__":
    unittest.main()
