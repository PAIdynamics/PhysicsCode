import tempfile
import unittest
from pathlib import Path

from physicscode_science.models import LicenseFinding, RepositoryConfig, RepositoryRevision, SourceFile
from physicscode_science.parsers.basic import _matches_for_language, parse_source_file
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


class CppCommentFalsePositiveTest(unittest.TestCase):
    """Regression tests for issue #8: symbols taken from comments or initializers."""

    def names(self, source: str) -> list[str]:
        return [str(match["name"]) for match in _matches_for_language("cpp", source.splitlines())]

    def test_constructor_initializer_with_trailing_comment_is_not_a_symbol(self):
        # OPALX src/Utilities/ComplexErrorFun.cpp:57
        self.assertEqual(self.names("    std::complex<double> s(0.0);             // s_{N}"), [])

    def test_parenthesis_in_trailing_doxygen_comment_is_not_a_symbol(self):
        # Shape of OPALX src/AbsBeamline/BendFieldModel.h:159
        self.assertEqual(self.names("    double curvature;  ///< curvature of the bend (1/h)"), [])

    def test_text_inside_multiline_block_comment_is_not_a_symbol(self):
        source = """
/*
   Evaluates f(x) on the mesh
*/
void deposit(int n) {
}
"""
        self.assertEqual(self.names(source), ["deposit"])

    def test_definition_with_trailing_comment_still_matches(self):
        self.assertEqual(self.names("void deposit_charge(int n) {  // hot loop"), ["deposit_charge"])

    def test_comment_markers_inside_string_literal_are_kept(self):
        source = 'int Client::open(const char* url = "http://x/*y") {'
        self.assertEqual(self.names(source), ["open"])

    def test_inline_block_comment_before_definition(self):
        self.assertEqual(self.names("/* API */ double energy(const State& s) {"), ["energy"])


if __name__ == "__main__":
    unittest.main()
