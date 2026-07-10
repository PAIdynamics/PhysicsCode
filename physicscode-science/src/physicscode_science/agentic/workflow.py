from __future__ import annotations

import json
import subprocess
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from physicscode_science.agentic.tasks import AgenticTask, CommandSpec, ScientificValidationSpec
from physicscode_science.agentic.validation import validation_template
from physicscode_science.models import SearchQuery, SearchResult
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore


def run_agentic_task(
    store: ScienceStore,
    task: AgenticTask,
    output_dir: str | Path,
    *,
    use_retrieval: bool = True,
) -> dict[str, object]:
    started = datetime.now(timezone.utc)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    evidence = _retrieve_evidence(store, task) if use_retrieval else []
    report = {
        "task": asdict(task),
        "mode": "retrieval" if use_retrieval else "no_retrieval_baseline",
        "started_at": started.isoformat(),
        "plan_before_edit": _plan(task),
        "evidence": [_evidence_item(item) for item in evidence],
        "evidence_backed_modification": _evidence_backed(task, evidence, use_retrieval),
        "source_license_report": _source_license_report(evidence, task.source_files),
        "compilation": _run_loop(task.compilation, task.workdir),
        "tests": _run_loop(task.tests, task.workdir),
        "scientific_validation": _run_scientific_loop(task.scientific_validation, task.workdir),
    }
    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    report["success"] = _success(report)
    report["failures"] = _failures(report)
    path = output / f"{task.task_id}-{report['mode']}.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    report["report_path"] = str(path)
    return report


def run_agentic_benchmark(
    store: ScienceStore,
    tasks: list[AgenticTask],
    output_dir: str | Path,
) -> dict[str, object]:
    retrieval_runs = [run_agentic_task(store, task, output_dir, use_retrieval=True) for task in tasks]
    baseline_runs = [run_agentic_task(store, task, output_dir, use_retrieval=False) for task in tasks]
    comparison = [
        {
            "task_id": task.task_id,
            "retrieval_success": bool(retrieval["success"]),
            "baseline_success": bool(baseline["success"]),
            "retrieval_failures": retrieval["failures"],
            "baseline_failures": baseline["failures"],
            "retrieval_evidence_count": len(retrieval["evidence"]),
            "baseline_evidence_count": len(baseline["evidence"]),
        }
        for task, retrieval, baseline in zip(tasks, retrieval_runs, baseline_runs, strict=True)
    ]
    report = {
        "task_count": len(tasks),
        "retrieval_success_rate": _rate(item["retrieval_success"] for item in comparison),
        "baseline_success_rate": _rate(item["baseline_success"] for item in comparison),
        "comparison": comparison,
        "retrieval_reports": [item["report_path"] for item in retrieval_runs],
        "baseline_reports": [item["report_path"] for item in baseline_runs],
    }
    path = Path(output_dir) / "agentic-benchmark.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    report["report_path"] = str(path)
    return report


def _retrieve_evidence(store: ScienceStore, task: AgenticTask) -> list[SearchResult]:
    query = task.evidence_query
    return search(
        store,
        SearchQuery(
            query=query.query,
            repositories=query.repositories,
            domains=query.domains,
            languages=query.languages,
            object_types=query.object_types,
            licenses=query.licenses,
            top_k=query.top_k,
        ),
    )


def _plan(task: AgenticTask) -> dict[str, object]:
    return {
        "status": "recorded_before_edit",
        "steps": list(task.plan),
        "expected_changes": [asdict(change) for change in task.expected_changes],
    }


def _evidence_backed(task: AgenticTask, evidence: list[SearchResult], use_retrieval: bool) -> dict[str, object]:
    required_changes = [change for change in task.expected_changes if change.evidence_required]
    missing = []
    if task.requires_evidence and not evidence:
        missing.append("task requires retrieval evidence but none was selected")
    if use_retrieval and evidence:
        status = "passed"
    elif not task.requires_evidence and not required_changes:
        status = "not_applicable"
    else:
        status = "failed"
    return {
        "status": status,
        "retrieval_enabled": use_retrieval,
        "required_change_count": len(required_changes),
        "evidence_count": len(evidence),
        "missing": missing,
    }


def _source_license_report(evidence: list[SearchResult], source_files: tuple[str, ...]) -> dict[str, object]:
    return {
        "declared_source_files": list(source_files),
        "retrieved_sources": [
            {
                "repository": item.repository,
                "repository_url": item.repository_url,
                "commit": item.commit,
                "path": item.path,
                "lines": f"{item.start_line}-{item.end_line}",
                "symbol": item.symbol,
                "license": item.license,
                "reason": item.reason,
            }
            for item in evidence
        ],
        "license_summary": sorted({item.license for item in evidence}),
    }


def _run_loop(specs: tuple[CommandSpec, ...], workdir: str) -> list[dict[str, object]]:
    return [_run_command(spec, workdir) for spec in specs]


def _run_scientific_loop(
    specs: tuple[ScientificValidationSpec, ...],
    workdir: str,
) -> list[dict[str, object]]:
    return [
        {
            **_run_command(spec, workdir),
            "template": spec.template,
            "criterion": spec.criterion,
            "template_guidance": validation_template(spec.template),
        }
        for spec in specs
    ]


def _run_command(spec: CommandSpec, workdir: str) -> dict[str, object]:
    started = perf_counter()
    if not spec.command:
        return {
            "name": spec.name,
            "command": [],
            "status": "failed",
            "exit_code": None,
            "duration_seconds": 0.0,
            "stdout_tail": "",
            "stderr_tail": "missing command",
        }
    try:
        completed = subprocess.run(
            list(spec.command),
            cwd=workdir,
            check=False,
            capture_output=True,
            text=True,
            timeout=spec.timeout_seconds,
        )
        status = "passed" if completed.returncode == 0 else "failed"
        return {
            "name": spec.name,
            "command": list(spec.command),
            "status": status,
            "exit_code": completed.returncode,
            "duration_seconds": round(perf_counter() - started, 6),
            "stdout_tail": _tail(completed.stdout),
            "stderr_tail": _tail(completed.stderr),
        }
    except subprocess.TimeoutExpired as error:
        return {
            "name": spec.name,
            "command": list(spec.command),
            "status": "failed",
            "exit_code": None,
            "duration_seconds": round(perf_counter() - started, 6),
            "stdout_tail": _tail(error.stdout or ""),
            "stderr_tail": f"timed out after {spec.timeout_seconds}s\n{_tail(error.stderr or '')}".strip(),
        }


def _success(report: dict[str, object]) -> bool:
    if report["evidence_backed_modification"]["status"] == "failed":  # type: ignore[index]
        return False
    for section in ("compilation", "tests", "scientific_validation"):
        if any(item["status"] != "passed" for item in report[section]):  # type: ignore[index]
            return False
    return True


def _failures(report: dict[str, object]) -> list[dict[str, object]]:
    failures: list[dict[str, object]] = []
    evidence_status = report["evidence_backed_modification"]["status"]  # type: ignore[index]
    if evidence_status == "failed":
        failures.append(
            {
                "section": "evidence_backed_modification",
                "name": "retrieval evidence",
                "reason": report["evidence_backed_modification"]["missing"],  # type: ignore[index]
            }
        )
    for section in ("compilation", "tests", "scientific_validation"):
        for item in report[section]:  # type: ignore[index]
            if item["status"] != "passed":
                failures.append(
                    {
                        "section": section,
                        "name": item["name"],
                        "exit_code": item["exit_code"],
                        "stderr_tail": item["stderr_tail"],
                    }
                )
    return failures


def _evidence_item(item: SearchResult) -> dict[str, object]:
    return {
        "result_id": item.result_id,
        "repository": item.repository,
        "repository_url": item.repository_url,
        "commit": item.commit,
        "path": item.path,
        "start_line": item.start_line,
        "end_line": item.end_line,
        "symbol": item.symbol,
        "object_type": item.object_type,
        "language": item.language,
        "license": item.license,
        "score": item.score,
        "retrieval_channels": item.retrieval_channels,
        "reason": item.reason,
        "explanation": item.explanation,
        "summary": item.summary,
    }


def _tail(value: str, limit: int = 4000) -> str:
    return value[-limit:]


def _rate(values: object) -> float:
    materialized = [bool(value) for value in values]
    if not materialized:
        return 0.0
    return round(sum(1 for value in materialized if value) / len(materialized), 6)

