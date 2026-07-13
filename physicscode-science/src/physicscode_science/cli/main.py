from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict
from pathlib import Path
from urllib.error import URLError

from physicscode_science.api.server import run_server
from physicscode_science.agentic.tasks import load_agentic_tasks
from physicscode_science.agentic.workflow import run_agentic_benchmark
from physicscode_science.enrichment.rebuild import metadata_report, rebuild_metadata
from physicscode_science.enrichment.taxonomy import load_taxonomy
from physicscode_science.ingestion.pipeline import ingest_repositories, ingest_repository
from physicscode_science.ingestion.papers import ingest_papers
from physicscode_science.evaluation.benchmarks import evaluate_search, load_benchmark_queries
from physicscode_science.licensing.policy import load_license_policy
from physicscode_science.mcp.server import serve_stdio
from physicscode_science.models import RepositoryConfig, SearchQuery
from physicscode_science.production import production_status
from physicscode_science.registry.config import enabled_repositories
from physicscode_science.retrieval.search import search
from physicscode_science.storage.content_store import ContentStore
from physicscode_science.storage.sqlite import ScienceStore
from physicscode_science.sync.repositories import sync_repositories
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
    ingest_papers_command = subcommands.add_parser(
        "ingest-papers",
        help="Index reference scientific papers as retrievable document chunks",
    )
    ingest_papers_command.add_argument("--papers-dir", default="/home/mohsen/ref-papers")
    ingest_papers_command.add_argument("--taxonomy", default="config/taxonomy.yaml")
    ingest_papers_command.add_argument("--db", default=".science/physicscode-science.sqlite")
    ingest_papers_command.add_argument("--report", default=".science/reports")
    ingest_papers_command.add_argument("--content-store", default=".science/content")
    ingest_papers_command.add_argument("--max-papers", type=int)
    ingest_papers_command.add_argument("--chunk-words", type=int, default=900)
    ingest_papers_command.add_argument("--chunk-overlap-words", type=int, default=120)
    sync = subcommands.add_parser(
        "sync-repositories",
        help="Report, fetch, or clone configured reference repositories.",
    )
    sync.add_argument("--registry", default="config/repositories.yaml")
    sync.add_argument("--repository", action="append", default=[])
    sync.add_argument("--fetch", action="store_true")
    sync.add_argument("--clone-missing", action="store_true")
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
    vector_index.add_argument("--qdrant-vector-mode", choices=["single", "multi"], default="single")
    vector_index.add_argument("--embedding-provider", choices=["hash", "vllm", "openai-compatible"])
    vector_index.add_argument("--embedding-url")
    vector_index.add_argument("--embedding-model")
    vector_index.add_argument("--embedding-api-key")
    vector_index.add_argument("--embedding-max-chars", type=int)
    vector_index.add_argument("--embedding-max-tokens", type=int)
    vector_index.add_argument(
        "--repository",
        action="append",
        default=[],
        help="Limit vector upsert to one repository name. Repeat for multiple repositories.",
    )
    status = subcommands.add_parser("status", help="Report science DB and vector-index readiness")
    status.add_argument("--db", default=".science/physicscode-science.sqlite")
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
            repositories = _selected_repositories(args.registry, args.repository)
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
    if args.command == "ingest-papers":
        store = ScienceStore(args.db)
        try:
            report = ingest_papers(
                args.papers_dir,
                store,
                args.report,
                content_store=ContentStore(args.content_store),
                taxonomy=load_taxonomy(args.taxonomy),
                max_papers=args.max_papers,
                chunk_words=args.chunk_words,
                chunk_overlap_words=args.chunk_overlap_words,
            )
            store.commit()
        finally:
            store.close()
        print(json.dumps(report, indent=2, sort_keys=True))
    if args.command == "sync-repositories":
        repositories = _selected_repositories(args.registry, args.repository)
        reports = sync_repositories(
            repositories,
            fetch=bool(args.fetch),
            clone_missing=bool(args.clone_missing),
        )
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
        _configure_embedding_environment(args)
        store = ScienceStore(args.db)
        try:
            store.migrate()
            if args.backend == "qdrant":
                try:
                    report = QdrantVectorIndex(
                        args.qdrant_url,
                        args.qdrant_collection,
                        dimensions=args.dimensions,
                        api_key=args.qdrant_api_key,
                        vector_mode=args.qdrant_vector_mode,
                    ).upsert_store(store, repositories=tuple(args.repository))
                except URLError as error:
                    raise SystemExit(
                        "Qdrant is not reachable. Start it first, for example:\n"
                        "  docker compose up -d qdrant\n"
                        "If Docker says permission denied, run that command with sudo or add your user "
                        "to the docker group and log out/in.\n"
                        f"Original error: {error}"
                    ) from error
            else:
                report = build_local_vector_index(
                    store,
                    args.output,
                    dimensions=args.dimensions,
                )
        finally:
            store.close()
        print(json.dumps(report, indent=2, sort_keys=True))
    if args.command == "status":
        store = ScienceStore(args.db)
        try:
            store.migrate()
            report = production_status(store)
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


def _selected_repositories(registry: str, names: list[str]) -> list[RepositoryConfig]:
    repositories = enabled_repositories(Path(registry))
    if names:
        selected = set(names)
        repositories = [repository for repository in repositories if repository.name in selected]
        missing = selected - {repository.name for repository in repositories}
        if missing:
            raise ValueError(f"unknown or disabled repositories: {', '.join(sorted(missing))}")
    return repositories


def _configure_embedding_environment(args: argparse.Namespace) -> None:
    if args.embedding_provider:
        os.environ["PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER"] = args.embedding_provider
    if args.embedding_url:
        os.environ["PHYSICSCODE_SCIENCE_EMBEDDING_URL"] = args.embedding_url
    if args.embedding_model:
        os.environ["PHYSICSCODE_SCIENCE_EMBEDDING_MODEL"] = args.embedding_model
    if args.embedding_api_key:
        os.environ["PHYSICSCODE_SCIENCE_EMBEDDING_API_KEY"] = args.embedding_api_key
    if getattr(args, "embedding_max_chars", None):
        os.environ["PHYSICSCODE_SCIENCE_EMBEDDING_MAX_CHARS"] = str(args.embedding_max_chars)
    if getattr(args, "embedding_max_tokens", None):
        os.environ["PHYSICSCODE_SCIENCE_EMBEDDING_MAX_TOKENS"] = str(args.embedding_max_tokens)


if __name__ == "__main__":
    main()
