import tempfile
import unittest
from pathlib import Path

from physicscode_science.registry.config import load_registry


class RegistryTest(unittest.TestCase):
    def test_load_registry_reads_repository_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "repositories.yaml"
            registry.write_text(
                """
repositories:
  - name: example
    url: https://example.invalid/repo
    local_path: /tmp/example
    default_branch: main
    revision_policy: fixed-local
    license_policy: allowed
    domains:
      - plasma-physics
    languages:
      - cpp
    priority: high
    enabled: true
""",
                encoding="utf-8",
            )

            repositories = load_registry(registry)

            self.assertEqual(len(repositories), 1)
            self.assertEqual(repositories[0].name, "example")
            self.assertEqual(repositories[0].domains, ("plasma-physics",))
            self.assertTrue(repositories[0].enabled)


if __name__ == "__main__":
    unittest.main()
