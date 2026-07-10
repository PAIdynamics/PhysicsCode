from __future__ import annotations

import re
from pathlib import Path

from physicscode_science.models import LicenseFinding
from physicscode_science.utils import read_text

LICENSE_FILES = ("LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING", "COPYRIGHT", "NOTICE")

LICENSE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Apache-2.0", re.compile(r"Apache License.*Version 2\.0", re.I | re.S)),
    ("BSD-3-Clause", re.compile(r"Redistribution and use in source and binary forms.*Neither the name", re.I | re.S)),
    ("BSD-2-Clause", re.compile(r"Redistribution and use in source and binary forms.*without modification", re.I | re.S)),
    ("MIT", re.compile(r"Permission is hereby granted, free of charge", re.I)),
    ("LGPL-2.1-or-later", re.compile(r"GNU Lesser General Public License.*version 2\.1", re.I | re.S)),
    ("LGPL-3.0-or-later", re.compile(r"GNU Lesser General Public License.*version 3", re.I | re.S)),
    ("GPL-3.0", re.compile(r"GNU General Public License.*version 3", re.I | re.S)),
    ("GPL-2.0", re.compile(r"GNU General Public License.*version 2", re.I | re.S)),
    ("HDF5", re.compile(r"Hierarchical Data Format.*HDF5", re.I | re.S)),
    ("NCSA", re.compile(r"University of Illinois/NCSA Open Source License", re.I)),
)

COPYRIGHT_PATTERN = re.compile(r"copyright\s*(?:\(c\))?\s*[^.\n\r]{1,160}", re.I)


def detect_repository_license(repo_path: str | Path) -> LicenseFinding:
    path = Path(repo_path)
    for name in LICENSE_FILES:
        candidate = path / name
        if candidate.exists() and candidate.is_file():
            return detect_license_text(read_text(candidate), "repository", str(candidate.relative_to(path)))
    return LicenseFinding(spdx_id="NOASSERTION", source="repository")


def detect_file_license(path: str | Path, repository_license: LicenseFinding) -> LicenseFinding:
    text = read_text(path)[:6000]
    finding = detect_license_text(text, "file-header", str(path))
    if finding.spdx_id != "NOASSERTION":
        return finding
    return repository_license


def detect_license_text(text: str, source: str, path: str | None = None) -> LicenseFinding:
    for spdx_id, pattern in LICENSE_PATTERNS:
        if pattern.search(text):
            return LicenseFinding(
                spdx_id=spdx_id,
                source=source,
                path=path,
                copyright=tuple(_copyrights(text)),
                reference_only=spdx_id.startswith(("GPL", "AGPL")),
            )
    return LicenseFinding(
        spdx_id="NOASSERTION",
        source=source,
        path=path,
        copyright=tuple(_copyrights(text)),
    )


def _copyrights(text: str) -> list[str]:
    return sorted({match.group(0).strip() for match in COPYRIGHT_PATTERN.finditer(text[:8000])})
