from __future__ import annotations

import argparse
import json
from pathlib import Path

from physicscode_science.ingestion.pipeline import ingest_repositories
from physicscode_science.licensing.policy import load_license_policy
from physicscode_science.registry.config import enabled_repositories
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


if __name__ == "__main__":
    main()
