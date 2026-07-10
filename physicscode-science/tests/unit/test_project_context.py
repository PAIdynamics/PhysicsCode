import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.context.project import inspect_project


class ProjectContextTest(unittest.TestCase):
    def test_inspect_project_reports_build_git_languages_and_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "CMakeLists.txt").write_text(
                "find_package(MPI REQUIRED)\ntarget_link_libraries(app MPI::MPI_CXX)\n",
                encoding="utf-8",
            )
            (root / "src").mkdir()
            (root / "src" / "solver.cpp").write_text("int solve() { return 0; }\n", encoding="utf-8")
            (root / "tests").mkdir()
            _init_git_repo(root)

            context = inspect_project(root)

            self.assertEqual(context["git"]["branch"], "main")
            self.assertIn("cpp", context["languages"])
            self.assertIn("CMakeLists.txt", context["build_files"])
            self.assertEqual(context["test_paths"], ["tests"])
            self.assertIn("find_package(MPI REQUIRED)", context["dependencies"]["cmake"])


def _init_git_repo(repo: Path) -> None:
    subprocess.run(["git", "-C", str(repo), "init", "-b", "main"], check=True, stdout=subprocess.PIPE)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test User"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "initial"], check=True, stdout=subprocess.PIPE)


if __name__ == "__main__":
    unittest.main()
