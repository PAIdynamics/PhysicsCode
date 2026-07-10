import tempfile
import unittest
from pathlib import Path

from physicscode_science.ingestion.filtering import iter_indexable_files, language_for


class FilteringTest(unittest.TestCase):
    def test_filters_supported_files_and_excluded_dirs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src").mkdir()
            (root / "src" / "kernel.cu").write_text("__global__ void k() {}\n", encoding="utf-8")
            (root / ".git").mkdir()
            (root / ".git" / "ignored.cpp").write_text("int ignored() { return 0; }\n", encoding="utf-8")

            files = iter_indexable_files(root)

            self.assertEqual(language_for(root / "CMakeLists.txt"), "cmake")
            self.assertEqual([(path.name, language) for path, language in files], [("kernel.cu", "cuda")])

    def test_include_and_exclude_paths_limit_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src").mkdir()
            (root / "src" / "keep.cpp").write_text("int keep() { return 0; }\n", encoding="utf-8")
            (root / "src" / "generated").mkdir()
            (root / "src" / "generated" / "skip.cpp").write_text("int skip() { return 0; }\n", encoding="utf-8")
            (root / "docs").mkdir()
            (root / "docs" / "skip.md").write_text("# skip\n", encoding="utf-8")

            files = iter_indexable_files(
                root,
                include_paths=("src",),
                exclude_paths=("src/generated",),
            )

            self.assertEqual([(path.name, language) for path, language in files], [("keep.cpp", "cpp")])


if __name__ == "__main__":
    unittest.main()
