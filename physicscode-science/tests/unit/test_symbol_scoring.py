import unittest

from physicscode_science.models import SearchCandidate
from physicscode_science.reranking.scoring import _exact_symbol_bonus
from physicscode_science.retrieval.symbol import symbol_scores
from physicscode_science.retrieval.tokenize import mentions_symbol, significant_terms


def candidate(symbol: str) -> SearchCandidate:
    return SearchCandidate(
        object_id=symbol,
        repository="opalx",
        repository_url="https://example.invalid/opalx",
        commit="abc123",
        path="src/AbsBeamline/BendFieldModel.h",
        start_line=1,
        end_line=2,
        symbol=symbol,
        object_type="function",
        language="cpp",
        license="GPL-3.0",
        raw_content="",
        metadata={},
    )


class SymbolScoringTest(unittest.TestCase):
    """Regression tests for issue #8: short symbols matching as substrings."""

    def test_mentions_symbol_requires_identifier_boundaries(self):
        self.assertFalse(mentions_symbol("how is the bend field computed", "s"))
        self.assertFalse(mentions_symbol("getCurvature", "Curvature"))
        self.assertTrue(mentions_symbol("where is getCurvature defined?", "getcurvature"))
        self.assertTrue(mentions_symbol("BendFieldModel::getCurvature()", "getCurvature"))
        self.assertFalse(mentions_symbol("anything", ""))

    def test_single_letter_symbols_do_not_score_on_unrelated_query(self):
        scores = symbol_scores(
            "how is the bend field computed in OPALX",
            [candidate("s"), candidate("h"), candidate("getCurvature")],
        )
        self.assertEqual(scores, {})

    def test_exact_symbol_still_scores_one(self):
        scores = symbol_scores("where is getCurvature defined", [candidate("getCurvature")])
        self.assertEqual(scores, {"getCurvature": 1.0})

    def test_rerank_exact_bonus_ignores_substring_hits(self):
        terms = set(significant_terms("how is the bend field computed in OPALX"))
        self.assertEqual(_exact_symbol_bonus(terms, "h"), 0.0)
        terms = set(significant_terms("deposit_charge kernel"))
        self.assertEqual(_exact_symbol_bonus(terms, "deposit_charge"), 0.18)


if __name__ == "__main__":
    unittest.main()
