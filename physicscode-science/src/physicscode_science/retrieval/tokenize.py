from __future__ import annotations

import re

TOKEN_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?")


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(text)]


def split_identifier(text: str) -> list[str]:
    pieces = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text.replace("_", " "))
    return tokenize(pieces)
