import tempfile
import unittest
from pathlib import Path

from physicscode_science.licensing.policy import load_license_policy
from physicscode_science.models import LicenseFinding


class LicensePolicyTest(unittest.TestCase):
    def test_loads_policy_and_applies_unknown_default(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "licenses.yaml"
            path.write_text(
                """
allowed:
  - MIT
reference_only:
  - GPL-3.0
unknown_policy: exclude
""",
                encoding="utf-8",
            )

            policy = load_license_policy(path)

            self.assertTrue(policy.allows(LicenseFinding("MIT", "repository"), "allowed"))
            self.assertTrue(policy.allows(LicenseFinding("GPL-3.0", "repository"), "reference-only"))
            self.assertFalse(policy.allows(LicenseFinding("GPL-3.0", "repository"), "allowed"))
            self.assertFalse(policy.allows(LicenseFinding("NOASSERTION", "repository"), "allowed"))
            self.assertTrue(policy.allows(LicenseFinding("NOASSERTION", "repository"), "reference-only"))


if __name__ == "__main__":
    unittest.main()
