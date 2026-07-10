from __future__ import annotations

from dataclasses import replace

from physicscode_science.models import ParsedObject

VIEW_MODEL = "deterministic-template"
VIEW_MODEL_VERSION = "deterministic-template-v1"


def add_generated_views(parsed: ParsedObject) -> ParsedObject:
    scientific = parsed.metadata.get("scientific_metadata", {})
    if not isinstance(scientific, dict):
        scientific = {}
    algorithms = _values(scientific.get("algorithms", []))
    domains = _values(scientific.get("domains", [])) or [str(item) for item in parsed.metadata.get("domains", [])]
    equations = _values(scientific.get("equations", []))
    parallel_models = _values(scientific.get("parallel_models", []))
    hardware = _values(scientific.get("hardware_backends", []))
    metadata = dict(parsed.metadata)
    metadata["generated_views"] = {
        "model": VIEW_MODEL,
        "model_version": VIEW_MODEL_VERSION,
        "provenance": "deterministic template over parsed source and scientific metadata",
        "summary": _summary(parsed, domains, algorithms, equations, parallel_models, hardware),
        "queries": _queries(parsed, domains, algorithms, equations, parallel_models, hardware),
    }
    return replace(
        parsed,
        metadata=metadata,
        summary_model=VIEW_MODEL,
        summary_model_version=VIEW_MODEL_VERSION,
    )


def _summary(
    parsed: ParsedObject,
    domains: list[str],
    algorithms: list[str],
    equations: list[str],
    parallel_models: list[str],
    hardware: list[str],
) -> str:
    parts = [
        f"{parsed.object_type} `{parsed.qualified_name}` in {parsed.language}",
        f"from {parsed.repository}:{parsed.path}:{parsed.start_line}",
    ]
    if domains:
        parts.append(f"related to {', '.join(domains[:3])}")
    if algorithms:
        parts.append(f"with algorithm tags {', '.join(algorithms[:3])}")
    if equations:
        parts.append(f"and equation tags {', '.join(equations[:3])}")
    if parallel_models or hardware:
        parts.append(f"using {', '.join([*parallel_models, *hardware][:4])}")
    return "; ".join(parts) + "."


def _queries(
    parsed: ParsedObject,
    domains: list[str],
    algorithms: list[str],
    equations: list[str],
    parallel_models: list[str],
    hardware: list[str],
) -> list[str]:
    subject = " ".join([*domains[:2], *algorithms[:2], *equations[:1]]).strip()
    implementation = " ".join([parsed.language, *parallel_models[:2], *hardware[:1]]).strip()
    return [
        f"How is {parsed.qualified_name} implemented?",
        f"Example {implementation} implementation for {subject}".strip(),
        f"Find tests or examples related to {parsed.qualified_name} {subject}".strip(),
    ]


def _values(items: object) -> list[str]:
    if not isinstance(items, list):
        return []
    values = []
    for item in items:
        if isinstance(item, dict) and "value" in item:
            values.append(str(item["value"]))
    return values
