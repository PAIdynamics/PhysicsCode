from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CommandSpec:
    name: str
    command: tuple[str, ...]
    timeout_seconds: int = 60


@dataclass(frozen=True)
class ScientificValidationSpec(CommandSpec):
    template: str = "regression"
    criterion: str = ""


@dataclass(frozen=True)
class EvidenceQuery:
    query: str
    repositories: tuple[str, ...] = ()
    domains: tuple[str, ...] = ()
    languages: tuple[str, ...] = ()
    object_types: tuple[str, ...] = ()
    licenses: tuple[str, ...] = ()
    top_k: int = 5


@dataclass(frozen=True)
class ExpectedChange:
    path: str
    description: str
    evidence_required: bool = True


@dataclass(frozen=True)
class AgenticTask:
    task_id: str
    title: str
    prompt: str
    workdir: str
    plan: tuple[str, ...]
    evidence_query: EvidenceQuery
    expected_changes: tuple[ExpectedChange, ...]
    compilation: tuple[CommandSpec, ...]
    tests: tuple[CommandSpec, ...]
    scientific_validation: tuple[ScientificValidationSpec, ...]
    source_files: tuple[str, ...]
    requires_evidence: bool = True


def load_agentic_tasks(path: str | Path) -> list[AgenticTask]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [_task(item) for item in data.get("tasks", [])]


def _task(item: dict[str, object]) -> AgenticTask:
    prompt = str(item["prompt"])
    retrieval = _dict(item.get("retrieval", {}))
    return AgenticTask(
        task_id=str(item["task_id"]),
        title=str(item.get("title", item["task_id"])),
        prompt=prompt,
        workdir=str(item.get("workdir", ".")),
        plan=tuple(str(step) for step in item.get("plan", _default_plan())),
        evidence_query=EvidenceQuery(
            query=str(retrieval.get("query", prompt)),
            repositories=_tuple(retrieval.get("repositories", [])),
            domains=_tuple(retrieval.get("domains", [])),
            languages=_tuple(retrieval.get("languages", [])),
            object_types=_tuple(retrieval.get("object_types", [])),
            licenses=_tuple(retrieval.get("licenses", [])),
            top_k=int(retrieval.get("top_k", 5)),
        ),
        expected_changes=tuple(
            ExpectedChange(
                path=str(change.get("path", "")),
                description=str(change.get("description", "")),
                evidence_required=bool(change.get("evidence_required", True)),
            )
            for change in _list(item.get("expected_changes", []))
        ),
        compilation=_commands(item.get("compilation", [])),
        tests=_commands(item.get("tests", [])),
        scientific_validation=tuple(
            ScientificValidationSpec(
                name=str(spec.get("name", "scientific-validation")),
                command=_tuple(spec.get("command", [])),
                timeout_seconds=int(spec.get("timeout_seconds", 60)),
                template=str(spec.get("template", "regression")),
                criterion=str(spec.get("criterion", "")),
            )
            for spec in _list(item.get("scientific_validation", []))
        ),
        source_files=_tuple(item.get("source_files", [])),
        requires_evidence=bool(item.get("requires_evidence", True)),
    )


def _commands(value: object) -> tuple[CommandSpec, ...]:
    return tuple(
        CommandSpec(
            name=str(spec.get("name", "command")),
            command=_tuple(spec.get("command", [])),
            timeout_seconds=int(spec.get("timeout_seconds", 60)),
        )
        for spec in _list(value)
    )


def _default_plan() -> tuple[str, ...]:
    return (
        "Clarify the requested scientific behavior and numerical constraints.",
        "Retrieve source examples, APIs, tests, and license information before editing.",
        "Apply the smallest evidence-backed code change.",
        "Run compilation checks.",
        "Run tests.",
        "Run scientific validation separately from compilation.",
        "Record failures, provenance, and license constraints.",
    )


def _dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list[dict[str, object]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        return (value,)
    if isinstance(value, list):
        return tuple(str(item) for item in value)
    if isinstance(value, tuple):
        return tuple(str(item) for item in value)
    return ()

