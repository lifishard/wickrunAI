import copy
import datetime
import hashlib
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("ios_profile", pathlib.Path(__file__).parents[1] / "scripts" / "ios-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AppStoreProfileTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 9, 27, tzinfo=datetime.timezone.utc)
        self.cert = b"test certificate metadata only; never a real signing key"
        self.sha = hashlib.sha1(self.cert).hexdigest().upper()
        self.identities = f'1) {self.sha} "Apple Distribution: Example (ABCDE12345)"\n1 valid identities found'
        self.profile = {
            "UUID": "00000000-1111-2222-3333-444444444444", "TeamIdentifier": ["ABCDE12345"], "Platform": ["iOS"],
            "ExpirationDate": datetime.datetime(2027, 1, 1), "DeveloperCertificates": [self.cert],
            "Entitlements": {"application-identifier": "ABCDE12345.dev.anyai.app", "com.apple.developer.team-identifier": "ABCDE12345", "get-task-allow": False, "beta-reports-active": True},
        }

    def validate(self, profile=None, identities=None):
        return module.validate_profile(profile or self.profile, "ABCDE12345", "dev.anyai.app", identities or self.identities, self.now)

    def test_matching_profile_selects_certificate(self):
        metadata, certificate = self.validate()
        self.assertEqual(metadata["certificateSha1"], self.sha)
        self.assertEqual(certificate, self.cert)

    def test_expired_wrong_team_and_wrong_platform_fail(self):
        for key, value in [("ExpirationDate", datetime.datetime(2026, 1, 1)), ("TeamIdentifier", ["ZZZZZ12345"]), ("Platform", ["OSX"])]:
            with self.subTest(key=key):
                profile = copy.deepcopy(self.profile)
                profile[key] = value
                with self.assertRaises(ValueError): self.validate(profile)

    def test_development_adhoc_enterprise_and_wildcard_fail(self):
        for change in [
            {"ProvisionedDevices": ["device"]}, {"ProvisionsAllDevices": True},
            {"Entitlements": {**self.profile["Entitlements"], "get-task-allow": True}},
            {"Entitlements": {**self.profile["Entitlements"], "application-identifier": "ABCDE12345.*"}},
            {"Entitlements": {**self.profile["Entitlements"], "beta-reports-active": False}},
        ]:
            with self.subTest(change=change):
                with self.assertRaises(ValueError): self.validate({**self.profile, **change})

    def test_absent_or_wrong_certificate_and_development_identity_fail(self):
        for identities in ["0 valid identities found", self.identities.replace(self.sha, "A" * 40), self.identities.replace("Apple Distribution:", "Apple Development:"), self.identities.replace("ABCDE12345", "ZZZZZ12345")]:
            with self.subTest(identities=identities):
                with self.assertRaises(ValueError): self.validate(identities=identities)


if __name__ == "__main__":
    unittest.main()
