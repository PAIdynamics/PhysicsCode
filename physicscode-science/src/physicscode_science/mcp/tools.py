from __future__ import annotations

from dataclasses import asdict
from typing import Any

from physicscode_science.models import SearchQuery
from physicscode_science.context.project import inspect_project
from physicscode_science.graph.context import get_context
from physicscode_science.production import production_status
from physicscode_science.retrieval.search import search
from physicscode_science.storage.sqlite import ScienceStore


# Tools that read the server's own filesystem. They only make sense when the
# client and server share a machine (stdio); over HTTP the caller may be any
# PhysicsCode account, and the path would resolve on the index host.
LOCAL_ONLY_TOOLS = frozenset({"science_project_context"})

# Every tool only reads the index; clients can skip per-call approval.
READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}

TITLES = {
    "science_search": "Search scientific code",
    "science_get_source": "Get source object",
    "science_get_symbol": "Look up symbol",
    "science_get_context": "Get context for a query",
    "science_check_license": "Check reuse license",
    "science_project_context": "Inspect local project",
    "science_status": "Index status",
}


class UnknownToolError(ValueError):
    pass


def tool_definitions(remote: bool = False) -> list[dict[str, Any]]:
    return [
        {**tool, "title": TITLES[tool["name"]], "annotations": {"title": TITLES[tool["name"]], **READ_ONLY}}
        for tool in _base_definitions()
        if not (remote and tool["name"] in LOCAL_ONLY_TOOLS)
    ]


def _base_definitions() -> list[dict[str, Any]]:
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
                    "rerank": {"type": "boolean"},
                    "deduplicate": {"type": "boolean"},
                    "diversity": {"type": "boolean"},
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
                    "max_chars": {"type": "integer", "minimum": 500, "maximum": 50000},
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
        {
            "name": "science_status",
            "description": "Report science database and vector-index readiness for production retrieval.",
            "inputSchema": {"type": "object", "properties": {}},
        },
    ]


def call_tool(db_path: str, name: str, arguments: dict[str, Any], remote: bool = False) -> dict[str, Any]:
    if name not in TITLES or (remote and name in LOCAL_ONLY_TOOLS):
        raise UnknownToolError(f"unknown science tool: {name}")
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
            return get_context(
                store,
                str(arguments["query"]),
                top_k=int(arguments.get("top_k", 5)),
                max_chars=int(arguments.get("max_chars", 6000)),
            )
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
        if name == "science_status":
            status = production_status(store)
            return _public_status(status) if remote else status
        raise UnknownToolError(f"unknown science tool: {name}")
    finally:
        store.close()


def _public_status(status: dict[str, Any]) -> dict[str, Any]:
    # Remote callers get readiness and coverage, not host paths or internal
    # service URLs.
    vector_index = status.get("vector_index", {})
    database = status.get("database", {})
    return {
        "ready": status.get("ready"),
        "database": {
            "object_count": database.get("object_count"),
            "repositories": database.get("repositories"),
        },
        "vector_index": {
            "configured_backend": vector_index.get("configured_backend"),
            "dense_available": vector_index.get("dense_available"),
        },
    }


def _search_query(arguments: dict[str, Any]) -> SearchQuery:
    return SearchQuery(
        query=str(arguments["query"]),
        repositories=tuple(arguments.get("repositories", [])),
        domains=tuple(arguments.get("domains", [])),
        languages=tuple(arguments.get("languages", [])),
        object_types=tuple(arguments.get("object_types", [])),
        licenses=tuple(arguments.get("licenses", [])),
        rerank=bool(arguments.get("rerank", True)),
        deduplicate=bool(arguments.get("deduplicate", True)),
        diversity=bool(arguments.get("diversity", True)),
        top_k=int(arguments.get("top_k", 10)),
        include_content=bool(arguments.get("include_content", False)),
    )
