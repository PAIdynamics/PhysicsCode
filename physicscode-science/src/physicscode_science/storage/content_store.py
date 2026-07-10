from __future__ import annotations

import shutil
from pathlib import Path


class ContentStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def put_file(self, source: str | Path, content_hash: str) -> Path:
        destination = self.root / "sha256" / content_hash[:2] / content_hash
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copyfile(source, destination)
        return destination
