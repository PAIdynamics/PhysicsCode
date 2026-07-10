import unittest

from physicscode_science.licensing.detect import detect_license_text


class LicensingTest(unittest.TestCase):
    def test_detects_mit_license_and_copyright(self):
        finding = detect_license_text(
            """
MIT License

Copyright (c) 2026 PhysicsCode

Permission is hereby granted, free of charge, to any person obtaining a copy
""",
            "repository",
            "LICENSE",
        )

        self.assertEqual(finding.spdx_id, "MIT")
        self.assertEqual(finding.source, "repository")
        self.assertEqual(finding.copyright, ("Copyright (c) 2026 PhysicsCode",))


if __name__ == "__main__":
    unittest.main()
