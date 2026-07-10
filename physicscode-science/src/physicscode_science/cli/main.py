from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repositories
from physicscode_science.evaluation.benchmarks import evaluate_search, load_benchmark_queries
from physicscode_science.licensing.policy import load_license_policy
from physicscode_science.models import SearchQuery
from physicscode_science.registry.config import enabled_repositories
from physicscode_science.retrieval.search import search
from physicscode_science.storage.content_store import ContentStore
from physicscode_science.storage.sqlite import ScienceStore


def main() -> None:
    parser = argparse.ArgumentParser(prog="physicscode-science")
    subcommands = parser.add_subparsers(dest="command", required=True)
    ingest = subcommands.add_parser("ingest", help="Index configured scientific repositories")
    ingest.add_argument("--registry", default="config/repositories.yaml")
    ingest.add_argument("--licenses", default="config/licenses.yaml")
    ingest.add_argument("--db", default=".science/physicscode-science.sqlite")
    ingest.add_argument("--report", default=".science/reports")
    ingest.add_argument("--content-store", default=".science/content")
    ingest.add_argument("--max-files-per-repo", type=int)
    search_command = subcommands.add_parser("search", help="Search indexed scientific source objects")
    search_command.add_argument("query")
    search_command.add_argument("--db", default=".science/physicscode-science.sqlite")
    search_command.add_argument("--repository", action="append", default=[])
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
    evaluate = subcommands.add_parser("evaluate", help="Compare retrieval modes on benchmark queries")
    evaluate.add_argument("--db", default=".science/physicscode-science.sqlite")
    evaluate.add_argument("--queries", required=True)
    evaluate.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args()

    if args.command == "ingest":
        store = ScienceStore(args.db)
        try:
            reports = ingest_repositories(
                enabled_repositories(Path(args.registry)),
                store,
                args.report,
                max_files_per_repo=args.max_files_per_repo,
                license_policy=load_license_policy(args.licenses),
                content_store=ContentStore(args.content_store),
            )
        finally:
            store.close()
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
                    languages=tuple(args.language),
                    object_types=tuple(args.object_type),
                    licenses=tuple(args.license),
                    retrieval_channels=tuple(args.channel or ["dense", "sparse", "symbol"]),
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


if __name__ == "__main__":
    main()
