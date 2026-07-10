from __future__ import annotations

from dataclasses import asdict
from typing import Any

from physicscode_science.models import SearchQuery
from physicscode_science.context.project import inspect_project
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore


def tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "name": "science_search",
            "description": "Search indexed scientific source objects with hybrid dense, sparse, and symbol retrieval.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "repositories": {"type": "array", "items": {"type": "string"}},
                    "domains": {"type": "array", "items": {"type": "string"}},
                    "languages": {"type": "array", "items": {"type": "string"}},
                    "object_types": {"type": "array", "items": {"type": "string"}},
                    "licenses": {"type": "array", "items": {"type": "string"}},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 50},
                    "include_content": {"type": "boolean"},
                },
                "required": ["query"],
            },
        },
        {
            "name": "science_get_source",
            "description": "Return a retrieved source object by result_id/object_id with exact provenance.",
            "inputSchema": {
                "type": "object",
                "properties": {"object_id": {"type": "string"}},
                "required": ["object_id"],
            },
        },
        {
            "name": "science_get_symbol",
            "description": "Return indexed objects whose symbol exactly matches a name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "repository": {"type": "string"},
                },
                "required": ["symbol"],
            },
        },
        {
            "name": "science_get_context",
            "description": "Return compact context for a query, including retrieved source provenance and summaries.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 20},
                },
                "required": ["query"],
            },
        },
        {
            "name": "science_check_license",
            "description": "Check whether a retrieved source object is permissively reusable or reference-only.",
            "inputSchema": {
                "type": "object",
                "properties": {"object_id": {"type": "string"}},
                "required": ["object_id"],
            },
        },
        {
            "name": "science_project_context",
            "description": "Inspect a local scientific software project without modifying files.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "max_files": {"type": "integer", "minimum": 1, "maximum": 50000},
                },
                "required": ["path"],
            },
        },
    ]


def call_tool(db_path: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    store = ScienceStore(db_path)
    try:
        store.migrate()
        if name == "science_search":
            return {"results": [asdict(result) for result in search(store, _search_query(arguments))]}
        if name == "science_get_source":
            candidate = store.get_candidate(str(arguments["object_id"]))
            return {"source": asdict(candidate) if candidate else None}
        if name == "science_get_symbol":
            return {
                "results": [
                    asdict(candidate)
                    for candidate in store.get_symbol(
                        str(arguments["symbol"]),
                        str(arguments["repository"]) if arguments.get("repository") else None,
                    )
                ]
            }
        if name == "science_get_context":
            results = search(
                store,
                SearchQuery(
                    query=str(arguments["query"]),
                    top_k=int(arguments.get("top_k", 5)),
                    include_content=False,
                ),
            )
            return {
                "context": [
                    {
                        "repository": result.repository,
                        "commit": result.commit,
                        "path": result.path,
                        "line_range": [result.start_line, result.end_line],
                        "symbol": result.symbol,
                        "license": result.license,
                        "summary": result.summary,
                        "result_id": result.result_id,
                    }
                    for result in results
                ]
            }
        if name == "science_check_license":
            candidate = store.get_candidate(str(arguments["object_id"]))
            if not candidate:
                return {"found": False}
            return {
                "found": True,
                "license": candidate.license,
                "reference_only": candidate.license.startswith(("GPL", "AGPL")) or candidate.license == "NOASSERTION",
                "repository": candidate.repository,
                "path": candidate.path,
                "object_id": candidate.object_id,
            }
        if name == "science_project_context":
            return inspect_project(str(arguments["path"]), max_files=int(arguments.get("max_files", 5000)))
        raise ValueError(f"unknown science tool: {name}")
    finally:
        store.close()


def _search_query(arguments: dict[str, Any]) -> SearchQuery:
    return SearchQuery(
        query=str(arguments["query"]),
        repositories=tuple(arguments.get("repositories", [])),
        domains=tuple(arguments.get("domains", [])),
        languages=tuple(arguments.get("languages", [])),
        object_types=tuple(arguments.get("object_types", [])),
        licenses=tuple(arguments.get("licenses", [])),
        top_k=int(arguments.get("top_k", 10)),
        include_content=bool(arguments.get("include_content", False)),
    )
