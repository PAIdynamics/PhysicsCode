from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib import error, request

from physicscode_science.models import SearchCandidate
from physicscode_science.retrieval.vector import (
    DEFAULT_VECTOR_DIMENSIONS,
    dense_vector,
    vectorize_candidate,
    vectorize_query,
)

DEFAULT_MAX_EMBEDDING_TOKENS = 1800


@dataclass(frozen=True)
class EmbeddingModel:
    provider: str
    model: str
    dimensions: int
    version: str
    fallback: bool = False


class EmbeddingProvider:
    def model(self) -> EmbeddingModel:
        raise NotImplementedError

    def embed_text(self, text: str) -> list[float]:
        raise NotImplementedError

    def embed_candidate(self, candidate: SearchCandidate) -> list[float]:
        raise NotImplementedError


class HashEmbeddingProvider(EmbeddingProvider):
    def __init__(self, dimensions: int = DEFAULT_VECTOR_DIMENSIONS) -> None:
        self.dimensions = dimensions

    def model(self) -> EmbeddingModel:
        return EmbeddingModel(
            provider="hash",
            model="deterministic-hash",
            dimensions=self.dimensions,
            version="hash-embedding-v1",
            fallback=True,
        )

    def embed_text(self, text: str) -> list[float]:
        return dense_vector(vectorize_query(text, self.dimensions), self.dimensions)

    def embed_candidate(self, candidate: SearchCandidate) -> list[float]:
        return dense_vector(vectorize_candidate(candidate, self.dimensions), self.dimensions)


class OpenAICompatibleEmbeddingProvider(EmbeddingProvider):
    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        dimensions: int = DEFAULT_VECTOR_DIMENSIONS,
        api_key: str | None = None,
        timeout_seconds: int = 60,
        max_candidate_chars: int = 4000,
        max_input_tokens: int = DEFAULT_MAX_EMBEDDING_TOKENS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model_name = model
        self.dimensions = dimensions
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.max_candidate_chars = max_candidate_chars
        self.max_input_tokens = max_input_tokens

    def model(self) -> EmbeddingModel:
        return EmbeddingModel(
            provider="openai-compatible",
            model=self.model_name,
            dimensions=self.dimensions,
            version="openai-compatible-embeddings-v1",
        )

    def embed_text(self, text: str) -> list[float]:
        text = truncate_for_embedding(text, max_tokens=self.max_input_tokens)
        payload: dict[str, object] = {
            "model": self.model_name,
            "input": text,
        }
        try:
            response = self._request("/v1/embeddings", payload)
        except RuntimeError as exc:
            if "maximum context length" not in str(exc) and "input_tokens" not in str(exc):
                raise
            payload["input"] = truncate_for_embedding(text, max_tokens=max(1, self.max_input_tokens // 2))
            response = self._request("/v1/embeddings", payload)
        data = response.get("data", [])
        if not data or not isinstance(data, list):
            raise RuntimeError("embedding response did not include data")
        embedding = data[0].get("embedding") if isinstance(data[0], dict) else None
        if not isinstance(embedding, list):
            raise RuntimeError("embedding response did not include an embedding vector")
        vector = [float(value) for value in embedding]
        if len(vector) != self.dimensions:
            self.dimensions = len(vector)
        return vector

    def embed_candidate(self, candidate: SearchCandidate) -> list[float]:
        text = candidate_embedding_text(candidate, max_raw_chars=self.max_candidate_chars)
        return self.embed_text(text[: self.max_candidate_chars])

    def _request(self, path: str, payload: dict[str, object]) -> dict[str, object]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        req = request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            content = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"embedding request failed with HTTP {exc.code}: {content}") from exc


def configured_embedding_provider(
    *,
    dimensions: int = DEFAULT_VECTOR_DIMENSIONS,
    allow_fallback: bool = True,
) -> EmbeddingProvider:
    provider = os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_PROVIDER", "hash")
    if provider in {"openai", "openai-compatible", "vllm"}:
        endpoint = os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_URL", "http://127.0.0.1:8000")
        model = os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_MODEL")
        if not model:
            if allow_fallback:
                return HashEmbeddingProvider(dimensions)
            raise RuntimeError("PHYSICSCODE_SCIENCE_EMBEDDING_MODEL is required")
        key = os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_API_KEY")
        try:
            embedding_provider = OpenAICompatibleEmbeddingProvider(
                endpoint,
                model,
                dimensions=dimensions,
                api_key=key,
                max_candidate_chars=int(os.environ.get("PHYSICSCODE_SCIENCE_EMBEDDING_MAX_CHARS", "4000")),
                max_input_tokens=int(
                    os.environ.get(
                        "PHYSICSCODE_SCIENCE_EMBEDDING_MAX_TOKENS",
                        str(DEFAULT_MAX_EMBEDDING_TOKENS),
                    )
                ),
            )
            embedding_provider.embed_text("embedding health check")
            return embedding_provider
        except (OSError, RuntimeError, error.URLError, TimeoutError):
            if allow_fallback:
                return HashEmbeddingProvider(dimensions)
            raise
    return HashEmbeddingProvider(dimensions)


def candidate_embedding_text(candidate: SearchCandidate, *, max_raw_chars: int = 8000) -> str:
    metadata = candidate.metadata.get("metadata", {})
    return "\n".join(
        [
            f"repository: {candidate.repository}",
            f"path: {candidate.path}",
            f"symbol: {candidate.symbol}",
            f"type: {candidate.object_type}",
            f"language: {candidate.language}",
            f"metadata: {json.dumps(metadata, sort_keys=True)}",
            candidate.raw_content[:max_raw_chars],
        ]
    )


def truncate_for_embedding(text: str, *, max_tokens: int = DEFAULT_MAX_EMBEDDING_TOKENS) -> str:
    if max_tokens <= 0:
        return ""
    words = text.split()
    if not words:
        return text[: max_tokens * 3]
    # SentencePiece/BPE tokenizers often split code identifiers and punctuation
    # more aggressively than whitespace. Keep a conservative word budget and
    # char cap so local embedding servers with 2k-token limits stay healthy.
    max_words = max(1, int(max_tokens * 0.55))
    max_chars = max_tokens * 3
    return " ".join(words[:max_words])[:max_chars]


def candidate_embedding_views(candidate: SearchCandidate, *, max_raw_chars: int = 8000) -> dict[str, str]:
    metadata = candidate.metadata.get("metadata", {})
    generated = metadata.get("generated_views", {}) if isinstance(metadata, dict) else {}
    scientific = metadata.get("scientific_metadata", {}) if isinstance(metadata, dict) else {}
    summary = ""
    queries: list[str] = []
    if isinstance(generated, dict):
        summary = str(generated.get("summary", ""))
        queries = [str(query) for query in generated.get("queries", []) if isinstance(query, str)]
    documentation = truncate_for_embedding("\n".join(
        [
            f"repository: {candidate.repository}",
            f"path: {candidate.path}",
            f"symbol: {candidate.symbol}",
            f"summary: {summary}",
            f"queries: {' | '.join(queries)}",
            f"scientific_metadata: {json.dumps(scientific, sort_keys=True)}",
        ]
    ))
    signature = truncate_for_embedding("\n".join(
        [
            f"repository: {candidate.repository}",
            f"path: {candidate.path}",
            f"symbol: {candidate.symbol}",
            f"type: {candidate.object_type}",
            f"language: {candidate.language}",
            candidate.raw_content.splitlines()[0] if candidate.raw_content else "",
        ]
    ))
    source = truncate_for_embedding("\n".join(
        [
            f"repository: {candidate.repository}",
            f"path: {candidate.path}",
            f"symbol: {candidate.symbol}",
            candidate.raw_content[:max_raw_chars],
        ]
    ))
    return {
        "summary": truncate_for_embedding(candidate_embedding_text(candidate, max_raw_chars=max_raw_chars)),
        "signature": signature,
        "source": source,
        "documentation": documentation,
    }
