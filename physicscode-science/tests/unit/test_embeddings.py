import os
import unittest
from unittest import mock

from physicscode_science.embeddings.providers import (
    HashEmbeddingProvider,
    configured_embedding_provider,
)


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


if __name__ == "__main__":
    unittest.main()
