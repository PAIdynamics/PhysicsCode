import os
import unittest
from unittest import mock

from physicscode_science.embeddings.providers import (
    HashEmbeddingProvider,
    OpenAICompatibleEmbeddingProvider,
    candidate_embedding_text,
    configured_embedding_provider,
    truncate_for_embedding,
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

    def test_truncate_for_embedding_uses_conservative_word_budget(self):
        text = " ".join(f"token{i}" for i in range(100))

        truncated = truncate_for_embedding(text, max_tokens=20)

        self.assertLessEqual(len(truncated.split()), 11)

    def test_openai_compatible_provider_retries_smaller_input_on_context_error(self):
        class RetryingProvider(OpenAICompatibleEmbeddingProvider):
            def __init__(self):  # noqa: ANN204
                super().__init__(
                    "http://example.invalid",
                    "embedding-model",
                    max_input_tokens=20,
                )
                self.inputs = []

            def _request(self, path, payload):  # noqa: ANN001, ANN202
                self.inputs.append(payload["input"])
                if len(self.inputs) == 1:
                    raise RuntimeError("maximum context length exceeded: input_tokens")
                return {"data": [{"embedding": [0.0, 1.0]}]}

        provider = RetryingProvider()

        vector = provider.embed_text(" ".join(f"token{i}" for i in range(100)))

        self.assertEqual(vector, [0.0, 1.0])
        self.assertGreater(len(provider.inputs[0]), len(provider.inputs[1]))


if __name__ == "__main__":
    unittest.main()
