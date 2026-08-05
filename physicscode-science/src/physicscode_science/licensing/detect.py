from __future__ import annotations

import re
from pathlib import Path

from physicscode_science.models import LicenseFinding
from physicscode_science.utils import read_text

LICENSE_FILES = ("LICENSE", "LICENSE.txt", "LICENSE.md", "License/License", "COPYING", "COPYRIGHT", "NOTICE")

LICENSE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Apache-2.0", re.compile(r"Apache License.*Version 2\.0", re.I | re.S)),
    ("BSD-3-Clause", re.compile(r"Redistribution and use in source and binary forms.*Neither the name", re.I | re.S)),
    ("BSD-2-Clause", re.compile(r"Redistribution and use in source and binary forms.*without modification", re.I | re.S)),
    ("MIT", re.compile(r"Permission is hereby granted, free of charge", re.I)),
    ("LGPL-2.1-or-later", re.compile(r"GNU Lesser General Public License.*version 2\.1", re.I | re.S)),
    ("LGPL-3.0-or-later", re.compile(r"GNU Lesser General Public License.*version 3", re.I | re.S)),
    ("GPL-3.0-or-later", re.compile(r"GPLv3\+|GNU General Public License.*version 3.*or later", re.I | re.S)),
    ("GPL-3.0", re.compile(r"GNU General Public License.*version 3", re.I | re.S)),
    ("GPL-2.0", re.compile(r"GNU General Public License.*version 2", re.I | re.S)),
    ("CeCILL-B", re.compile(r"CeCILL-B FREE SOFTWARE LICENSE AGREEMENT", re.I)),
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
    return _detect_from_license_glob(path) or LicenseFinding(spdx_id="NOASSERTION", source="repository")


def _detect_from_license_glob(path: Path) -> LicenseFinding | None:
    # Some repos split licensing across multiple files instead of a single
    # LICENSE (e.g. LICENSE-APACHE + LICENSE-CC-BY-4.0 for code vs. content).
    # None of the exact LICENSE_FILES names matched above, so fall back to
    # any top-level LICENSE* file. Prefer one that resolves to a permissive
    # SPDX id, since that's what matters for reusing source code; otherwise
    # take the first recognized license of any kind.
    try:
        candidates = sorted(p for p in path.glob("LICENSE*") if p.is_file())
    except OSError:
        return None
    findings = [
        detect_license_text(read_text(candidate), "repository", str(candidate.relative_to(path)))
        for candidate in candidates
    ]
    for finding in findings:
        if finding.spdx_id != "NOASSERTION" and not finding.reference_only:
            return finding
    for finding in findings:
        if finding.spdx_id != "NOASSERTION":
            return finding
    return None


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
