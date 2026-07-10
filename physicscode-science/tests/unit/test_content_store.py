import tempfile
import unittest
from pathlib import Path

from physicscode_science.storage.content_store import ContentStore
from physicscode_science.utils import sha256_bytes


class ContentStoreTest(unittest.TestCase):
    def test_put_file_uses_content_addressed_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.cpp"
            source.write_text("int main() { return 0; }\n", encoding="utf-8")
            content_hash = sha256_bytes(source.read_bytes())

            stored = ContentStore(root / "store").put_file(source, content_hash)

            self.assertEqual(stored.name, content_hash)
            self.assertEqual(stored.read_text(encoding="utf-8"), source.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
