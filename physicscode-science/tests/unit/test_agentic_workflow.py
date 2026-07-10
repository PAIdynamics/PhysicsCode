import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from physicscode_science.agentic.tasks import (
    AgenticTask,
    CommandSpec,
    EvidenceQuery,
    ExpectedChange,
    ScientificValidationSpec,
    load_agentic_tasks,
)
from physicscode_science.agentic.workflow import run_agentic_benchmark, run_agentic_task
from physicscode_science.ingestion.pipeline import ingest_repository
from physicscode_science.models import RepositoryConfig
from physicscode_science.storage.sqlite import ScienceStore


class AgenticWorkflowTest(unittest.TestCase):
    def test_agentic_task_records_plan_evidence_and_separate_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text(
                "double stable_timestep(double dx, double c) {\n  return 0.5 * dx / c;\n}\n",
                encoding="utf-8",
            )
            _init_git_repo(repo)
            workdir = root / "work"
            workdir.mkdir()
            (workdir / "candidate.py").write_text("def timestep(dx, c):\n    return 0.5 * dx / c\n", encoding="utf-8")
            (workdir / "test_candidate.py").write_text(
                "from candidate import timestep\nassert timestep(2.0, 4.0) == 0.25\n",
                encoding="utf-8",
            )
            (workdir / "validate_science.py").write_text(
                "from candidate import timestep\nassert timestep(2.0, 4.0) <= 2.0 / 4.0\n",
                encoding="utf-8",
            )
            store = _store_with_repo(root, repo)
            try:
                report = run_agentic_task(store, _task(workdir), root / "reports", use_retrieval=True)

                self.assertTrue(report["success"])
                self.assertEqual(report["plan_before_edit"]["status"], "recorded_before_edit")
                self.assertGreaterEqual(len(report["evidence"]), 1)
                self.assertEqual(report["evidence_backed_modification"]["status"], "passed")
                self.assertEqual(report["compilation"][0]["status"], "passed")
                self.assertEqual(report["tests"][0]["status"], "passed")
                self.assertEqual(report["scientific_validation"][0]["status"], "passed")
                self.assertEqual(report["scientific_validation"][0]["template"], "conservation")
                self.assertTrue(Path(report["report_path"]).exists())
            finally:
                store.close()

    def test_benchmark_compares_retrieval_with_no_retrieval_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text("int poisson_solver() { return 0; }\n", encoding="utf-8")
            _init_git_repo(repo)
            workdir = root / "work"
            workdir.mkdir()
            (workdir / "candidate.py").write_text("x = 1\n", encoding="utf-8")
            store = _store_with_repo(root, repo)
            try:
                report = run_agentic_benchmark(store, [_minimal_task(workdir)], root / "reports")

                self.assertEqual(report["task_count"], 1)
                self.assertEqual(report["comparison"][0]["retrieval_evidence_count"], 1)
                self.assertEqual(report["comparison"][0]["baseline_evidence_count"], 0)
                self.assertTrue(report["comparison"][0]["retrieval_success"])
                self.assertFalse(report["comparison"][0]["baseline_success"])
                self.assertEqual(report["baseline_success_rate"], 0.0)
            finally:
                store.close()

    def test_failures_are_recorded_instead_of_hidden(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = _repo(root)
            (repo / "solver.cpp").write_text("int poisson_solver() { return 0; }\n", encoding="utf-8")
            _init_git_repo(repo)
            workdir = root / "work"
            workdir.mkdir()
            (workdir / "candidate.py").write_text("x = 1\n", encoding="utf-8")
            (workdir / "broken.py").write_text("raise SystemExit(3)\n", encoding="utf-8")
            task = _minimal_task(
                workdir,
                tests=(CommandSpec("intentional failure", ("python3", "broken.py")),),
            )
            store = _store_with_repo(root, repo)
            try:
                report = run_agentic_task(store, task, root / "reports", use_retrieval=True)

                self.assertFalse(report["success"])
                self.assertEqual(report["failures"][0]["section"], "tests")
                self.assertEqual(report["failures"][0]["exit_code"], 3)
            finally:
                store.close()

    def test_task_loader_parses_scientific_validation_template(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tasks.json"
            path.write_text(
                json.dumps(
                    {
                        "tasks": [
                            {
                                "task_id": "convergence-smoke",
                                "prompt": "Check convergence",
                                "workdir": ".",
                                "retrieval": {"query": "poisson convergence", "top_k": 2},
                                "expected_changes": [{"path": "solver.cpp", "description": "add check"}],
                                "scientific_validation": [
                                    {
                                        "name": "mesh refinement",
                                        "command": ["python3", "validate.py"],
                                        "template": "convergence",
                                        "criterion": "observed order >= 1.8",
                                    }
                                ],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            tasks = load_agentic_tasks(path)

            self.assertEqual(tasks[0].evidence_query.top_k, 2)
            self.assertEqual(tasks[0].scientific_validation[0].template, "convergence")
            self.assertEqual(tasks[0].expected_changes[0].path, "solver.cpp")


def _task(workdir: Path) -> AgenticTask:
    return AgenticTask(
        task_id="stable-timestep",
        title="Stable timestep",
        prompt="Implement a stable CFL timestep helper",
        workdir=str(workdir),
        plan=("retrieve timestep examples", "edit candidate", "validate CFL condition"),
        evidence_query=EvidenceQuery("stable timestep CFL", languages=("cpp",), top_k=3),
        expected_changes=(ExpectedChange("candidate.py", "add CFL helper"),),
        compilation=(CommandSpec("compile python", ("python3", "-m", "py_compile", "candidate.py")),),
        tests=(CommandSpec("unit assertions", ("python3", "test_candidate.py")),),
        scientific_validation=(
            ScientificValidationSpec(
                name="CFL bound",
                command=("python3", "validate_science.py"),
                template="conservation",
                criterion="dt <= dx / c",
            ),
        ),
        source_files=("candidate.py",),
    )


def _minimal_task(
    workdir: Path,
    tests: tuple[CommandSpec, ...] = (),
) -> AgenticTask:
    return AgenticTask(
        task_id="poisson-smoke",
        title="Poisson smoke",
        prompt="Use a poisson solver pattern",
        workdir=str(workdir),
        plan=("retrieve poisson evidence", "validate candidate"),
        evidence_query=EvidenceQuery("poisson solver", languages=("cpp",), top_k=1),
        expected_changes=(ExpectedChange("candidate.py", "use poisson solver pattern"),),
        compilation=(CommandSpec("compile python", ("python3", "-m", "py_compile", "candidate.py")),),
        tests=tests,
        scientific_validation=(),
        source_files=("candidate.py",),
    )


def _store_with_repo(root: Path, repo: Path) -> ScienceStore:
    store = ScienceStore(root / "science.sqlite")
    ingest_repository(_config(repo), store, root / "reports")
    store.commit()
    return store


def _repo(root: Path) -> Path:
    repo = root / "repo"
    repo.mkdir()
    (repo / "LICENSE").write_text(
        "MIT License\n\nPermission is hereby granted, free of charge\n",
        encoding="utf-8",
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
