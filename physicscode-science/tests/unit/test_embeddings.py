import os
import unittest
from unittest import mock

from physicscode_science.embeddings.providers import (
    HashEmbeddingProvider,
    OpenAICompatibleEmbeddingProvider,
    candidate_embedding_text,
    configured_embedding_provider,
)
from physicscode_science.models import SearchCandidate


class EmbeddingProviderTest(unittest.TestCase):
    def test_hash_embedding_provider_is_deterministic(self):
        provider = HashEmbeddingProvider(dimensions=16)

        self.assertEqual(provider.embed_text("poisson solver"), provider.embed_text("poisson solver"))
        self.assertEqual(len(provider.embed_text("poisson solver")), 16)
        self.assertTrue(provider.model().fallback)

    def test_configured_provider_falls_back_when_vllm_model_is_missing(self):
        with mock.patch.dict(
            os.environ,
            {"PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER": "vllm"},
            clear=True,
        ):
            provider = configured_embedding_provider(dimensions=8)

        self.assertIsInstance(provider, HashEmbeddingProvider)
        self.assertEqual(provider.model().dimensions, 8)

    def test_candidate_embedding_text_limits_raw_content(self):
        candidate = SearchCandidate(
            object_id="obj",
            repository="repo",
            repository_url="https://example.invalid/repo",
            commit="abc",
            path="solver.cpp",
            start_line=1,
            end_line=1,
            symbol="solve",
            object_type="function",
            language="cpp",
            license="MIT",
            raw_content="abcdef",
            metadata={"metadata": {}},
        )

        text = candidate_embedding_text(candidate, max_raw_chars=3)

        self.assertIn("abc", text)
        self.assertNotIn("abcdef", text)

    def test_openai_compatible_provider_limits_candidate_text(self):
        class CapturingProvider(OpenAICompatibleEmbeddingProvider):
            def embed_text(self, text):  # noqa: ANN001, ANN202
                self.text = text
                return [0.0]

        candidate = SearchCandidate(
            object_id="obj",
            repository="repo",
            repository_url="https://example.invalid/repo",
            commit="abc",
            path="solver.cpp",
            start_line=1,
            end_line=1,
            symbol="solve",
            object_type="function",
            language="cpp",
            license="MIT",
            raw_content="x" * 1000,
            metadata={"metadata": {"domain": "pde"}},
        )
        provider = CapturingProvider(
            "http://example.invalid",
            "embedding-model",
            max_candidate_chars=64,
        )

        provider.embed_candidate(candidate)

        self.assertLessEqual(len(provider.text), 64)


if __name__ == "__main__":
    unittest.main()
