from __future__ import annotations

import re

TOKEN_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?")

# Common English function words. Excluded only from exact-match/overlap bonus
# terms (symbol.py, reranking/scoring.py) so a natural-language query like
# "How is P3M implemented in IPPL?" can't score a coincidental hit against a
# short/common candidate symbol (e.g. a function literally named `is`) above
# genuine semantic matches. BM25 doesn't need this: its IDF weighting already
# discounts terms that appear in most documents.
STOPWORDS = frozenset(
    {
        "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
        "how", "what", "when", "where", "why", "who", "which", "whom",
        "in", "on", "at", "by", "for", "of", "to", "with", "from", "into", "onto", "about",
        "and", "or", "but", "if", "so", "as", "it", "its", "this", "that", "these", "those",
        "do", "does", "did", "can", "could", "will", "would", "should", "shall", "may", "might", "must",
        "i", "you", "he", "she", "we", "they", "them", "his", "her", "our", "your", "their",
        "not", "no", "yes", "there", "here",
    }
)


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(text)]


def split_identifier(text: str) -> list[str]:
    pieces = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text.replace("_", " "))
    return tokenize(pieces)


def significant_terms(text: str) -> list[str]:
    """Tokenize and drop stopwords, for exact-match/overlap bonus scoring only."""
    return [token for token in tokenize(text) if token not in STOPWORDS]
