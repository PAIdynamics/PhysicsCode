from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from physicscode_science.api.server import run_server
from physicscode_science.agentic.tasks import load_agentic_tasks
from physicscode_science.agentic.workflow import run_agentic_benchmark
from physicscode_science.enrichment.rebuild import metadata_report, rebuild_metadata
from physicscode_science.enrichment.taxonomy import load_taxonomy
from physicscode_science.ingestion.pipeline import ingest_repositories, ingest_repository
from physicscode_science.evaluation.benchmarks import evaluate_search, load_benchmark_queries
from physicscode_science.licensing.policy import load_license_policy
from physicscode_science.mcp.server import serve_stdio
from physicscode_science.models import SearchQuery
from physicscode_science.registry.config import enabled_repositories
from physicscode_science.retrieval.search import search
from physicscode_science.storage.content_store import ContentStore
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.vector_index.local import build_local_vector_index
from physicscode_science.vector_index.qdrant import QdrantVectorIndex


def main() -> None:
    parser = argparse.ArgumentParser(prog="physicscode-science")
    subcommands = parser.add_subparsers(dest="command", required=True)
    ingest = subcommands.add_parser("ingest", help="Index configured scientific repositories")
    ingest.add_argument("--registry", default="config/repositories.yaml")
    ingest.add_argument("--licenses", default="config/licenses.yaml")
    ingest.add_argument("--taxonomy", default="config/taxonomy.yaml")
    ingest.add_argument("--db", default=".science/physicscode-science.sqlite")
    ingest.add_argument("--report", default=".science/reports")
    ingest.add_argument("--content-store", default=".science/content")
    ingest.add_argument(
        "--repository",
        action="append",
        default=[],
        help="Limit ingestion to one repository name. Repeat for multiple repositories.",
    )
    ingest.add_argument("--max-files-per-repo", type=int)
    ingest.add_argument("--max-objects-per-repo", type=int)
    ingest.add_argument(
        "--skip-relationships",
        action="store_true",
        help="Skip relationship graph extraction for faster initial search/vector-index population.",
    )
    ingest.add_argument(
        "--stream-reports",
        action="store_true",
        help="Print and commit one repository report at a time.",
    )
    search_command = subcommands.add_parser("search", help="Search indexed scientific source objects")
    search_command.add_argument("query")
    search_command.add_argument("--db", default=".science/physicscode-science.sqlite")
    search_command.add_argument("--repository", action="append", default=[])
    search_command.add_argument("--domain", action="append", default=[])
    search_command.add_argument("--language", action="append", default=[])
    search_command.add_argument("--object-type", action="append", default=[])
    search_command.add_argument("--license", action="append", default=[])
    search_command.add_argument(
        "--channel",
        action="append",
        choices=["dense", "sparse", "symbol"],
        default=[],
        help="Retrieval channel to use. Repeat for hybrid search. Defaults to all channels.",
    )
    search_command.add_argument("--top-k", type=int, default=10)
    search_command.add_argument("--include-content", action="store_true")
    search_command.add_argument("--no-rerank", action="store_true")
    search_command.add_argument("--no-deduplicate", action="store_true")
    search_command.add_argument("--no-diversity", action="store_true")
    evaluate = subcommands.add_parser("evaluate", help="Compare retrieval modes on benchmark queries")
    evaluate.add_argument("--db", default=".science/physicscode-science.sqlite")
    evaluate.add_argument("--queries", required=True)
    evaluate.add_argument("--top-k", type=int, default=10)
    agentic = subcommands.add_parser(
        "agentic-evaluate",
        help="Run plan/evidence/compile/test/scientific validation tasks with a no-retrieval baseline",
    )
    agentic.add_argument("--db", default=".science/physicscode-science.sqlite")
    agentic.add_argument("--tasks", required=True)
    agentic.add_argument("--output", default=".science/agentic-reports")
    vector_index = subcommands.add_parser(
        "build-vector-index",
        help="Build or refresh the dense vector index used by search",
    )
    vector_index.add_argument("--db", default=".science/physicscode-science.sqlite")
    vector_index.add_argument("--backend", choices=["local", "qdrant"], default="local")
    vector_index.add_argument("--output", default=".science/vector-index.json")
    vector_index.add_argument("--dimensions", type=int, default=1536)
    vector_index.add_argument("--qdrant-url", default="http://127.0.0.1:6333")
    vector_index.add_argument("--qdrant-collection", default="physicscode_science_summary")
    vector_index.add_argument("--qdrant-api-key")
    serve = subcommands.add_parser("serve", help="Run the science retrieval HTTP API")
    serve.add_argument("--db", default=".science/physicscode-science.sqlite")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    mcp = subcommands.add_parser("mcp", help="Run the science retrieval MCP stdio server")
    mcp.add_argument("--db", default=".science/physicscode-science.sqlite")
    enrich = subcommands.add_parser("enrich-metadata", help="Regenerate scientific metadata for stored objects")
    enrich.add_argument("--db", default=".science/physicscode-science.sqlite")
    enrich.add_argument("--taxonomy", default="config/taxonomy.yaml")
    report_metadata = subcommands.add_parser("metadata-report", help="Report scientific metadata coverage")
    report_metadata.add_argument("--db", default=".science/physicscode-science.sqlite")
    args = parser.parse_args()

    if args.command == "ingest":
        store = ScienceStore(args.db)
        try:
            repositories = enabled_repositories(Path(args.registry))
            if args.repository:
                selected = set(args.repository)
                repositories = [repository for repository in repositories if repository.name in selected]
                missing = selected - {repository.name for repository in repositories}
                if missing:
                    raise ValueError(f"unknown or disabled repositories: {', '.join(sorted(missing))}")
            license_policy = load_license_policy(args.licenses)
            content_store = ContentStore(args.content_store)
            taxonomy = load_taxonomy(args.taxonomy)
            if args.stream_reports:
                reports = []
                for repository in repositories:
                    report = ingest_repository(
                        repository,
                        store,
                        args.report,
                        max_files_per_repo=args.max_files_per_repo,
                        license_policy=license_policy,
                        content_store=content_store,
                        taxonomy=taxonomy,
                        extract_relationship_graph=not args.skip_relationships,
                        max_objects_per_repo=args.max_objects_per_repo,
                    )
                    store.commit()
                    reports.append(report)
                    print(json.dumps(report, sort_keys=True), flush=True)
            else:
                reports = ingest_repositories(
                    repositories,
                    store,
                    args.report,
                    max_files_per_repo=args.max_files_per_repo,
                    license_policy=license_policy,
                    content_store=content_store,
                    taxonomy=taxonomy,
                    extract_relationship_graph=not args.skip_relationships,
                    max_objects_per_repo=args.max_objects_per_repo,
                )
        finally:
            store.close()
        if not args.stream_reports:
            print(json.dumps(reports, indent=2, sort_keys=True))
    if args.command == "search":
        store = ScienceStore(args.db)
        try:
            store.migrate()
            results = search(
                store,
                SearchQuery(
                    query=args.query,
                    repositories=tuple(args.repository),
                    domains=tuple(args.domain),
                    languages=tuple(args.language),
                    object_types=tuple(args.object_type),
                    licenses=tuple(args.license),
                    retrieval_channels=tuple(args.channel or ["dense", "sparse", "symbol"]),
                    rerank=not args.no_rerank,
                    deduplicate=not args.no_deduplicate,
                    diversity=not args.no_diversity,
                    top_k=args.top_k,
                    include_content=args.include_content,
                ),
            )
        finally:
            store.close()
        print(json.dumps([asdict(result) for result in results], indent=2, sort_keys=True))
    if args.command == "evaluate":
        store = ScienceStore(args.db)
        try:
            store.migrate()
            report = evaluate_search(store, load_benchmark_queries(args.queries), top_k=args.top_k)
        finally:
            store.close()
        print(json.dumps(report, indent=2, sort_keys=True))
    if args.command == "agentic-evaluate":
        store = ScienceStore(args.db)
        try:
            store.migrate()
            report = run_agentic_benchmark(
                store,
                load_agentic_tasks(args.tasks),
                args.output,
            )
        finally:
            store.close()
        print(json.dumps(report, indent=2, sort_keys=True))
    if args.command == "build-vector-index":
        store = ScienceStore(args.db)
        try:
            store.migrate()
            if args.backend == "qdrant":
                report = QdrantVectorIndex(
                    args.qdrant_url,
                    args.qdrant_collection,
                    dimensions=args.dimensions,
                    api_key=args.qdrant_api_key,
                ).upsert_store(store)
            else:
                report = build_local_vector_index(
                    store,
                    args.output,
                    dimensions=args.dimensions,
                )
        finally:
            store.close()
        print(json.dumps(report, indent=2, sort_keys=True))
    if args.command == "serve":
        run_server(args.db, host=args.host, port=args.port)
    if args.command == "mcp":
        serve_stdio(args.db)
    if args.command == "enrich-metadata":
        store = ScienceStore(args.db)
        try:
            store.migrate()
            report = rebuild_metadata(store, load_taxonomy(args.taxonomy))
            store.commit()
        finally:
            store.close()
        print(json.dumps(report, indent=2, sort_keys=True))
    if args.command == "metadata-report":
        store = ScienceStore(args.db)
        try:
            store.migrate()
            report = metadata_report(store.parsed_objects())
        finally:
            store.close()
        print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
