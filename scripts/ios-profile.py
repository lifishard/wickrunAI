"""Validate an App Store profile against identities in the temporary CI keychain."""
import datetime
import hashlib
import json
import pathlib
import plistlib
import re
import subprocess
import sys


def validate_profile(profile, team_id, bundle_id, identities, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if not re.fullmatch(r"[A-Z0-9]{10}", team_id):
        raise ValueError("APPLE_TEAM_ID must be a 10-character Team ID")
    if not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", bundle_id):
        raise ValueError("Invalid application bundle ID")
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, datetime.datetime) or expiry.replace(tzinfo=datetime.timezone.utc) <= now:
        raise ValueError("Provisioning profile is expired or has no expiry")
    if profile.get("TeamIdentifier") != [team_id] or "iOS" not in profile.get("Platform", []):
        raise ValueError("Provisioning profile must belong to APPLE_TEAM_ID and support iOS")
    entitlements = profile.get("Entitlements", {})
    if entitlements.get("application-identifier") != f"{team_id}.{bundle_id}" or entitlements.get("com.apple.developer.team-identifier") != team_id:
        raise ValueError("Profile must match the exact app bundle ID and team, without a wildcard")
    if entitlements.get("get-task-allow") is not False or entitlements.get("beta-reports-active") is not True:
        raise ValueError("An App Store distribution profile is required")
    if "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices"):
        raise ValueError("Development, Ad Hoc and Enterprise profiles are not accepted")
    uuid = profile.get("UUID", "")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", uuid):
        raise ValueError("Invalid provisioning profile UUID")
    valid = {}
    for fingerprint, name in re.findall(r'\b([0-9A-F]{40})\s+"([^"]+)"', identities):
        if name.startswith(("Apple Distribution:", "iPhone Distribution:")) and name.endswith(f"({team_id})"):
            valid[fingerprint] = name
    certificates = {hashlib.sha1(cert).hexdigest().upper(): cert for cert in profile.get("DeveloperCertificates", [])}
    matching = set(valid) & set(certificates)
    if len(matching) != 1:
        raise ValueError("Exactly one valid Apple Distribution private-key identity must match the profile certificate and team")
    fingerprint = matching.pop()
    return {"uuid": uuid, "teamId": team_id, "bundleId": bundle_id, "certificateSha1": fingerprint, "profileExpires": expiry.isoformat()}, certificates[fingerprint]


if __name__ == "__main__":
    profile_path, identity_path, team, bundle, output_directory = sys.argv[1:]
    output = pathlib.Path(output_directory)
    try:
        with open(profile_path, "rb") as handle:
            profile = plistlib.load(handle)
        metadata, certificate = validate_profile(profile, team, bundle, pathlib.Path(identity_path).read_text())
        certificate_path = output / "signer.der"
        certificate_path.write_bytes(certificate)
        check = subprocess.run(["openssl", "x509", "-inform", "DER", "-in", str(certificate_path), "-checkend", "0", "-noout"], capture_output=True)
        if check.returncode:
            raise ValueError("Distribution certificate is invalid or expired")
        (output / "profile.json").write_text(json.dumps(metadata))
        options = {"method": "app-store-connect", "destination": "export", "signingStyle": "manual", "teamID": team,
                   "signingCertificate": metadata["certificateSha1"], "provisioningProfiles": {bundle: metadata["uuid"]},
                   "manageAppVersionAndBuildNumber": False, "stripSwiftSymbols": True}
        with (output / "ExportOptions.plist").open("wb") as handle:
            plistlib.dump(options, handle)
    except (ValueError, KeyError, TypeError, plistlib.InvalidFileException):
        # Diagnostics intentionally exclude profile/certificate payloads.
        print("iOS signing validation failed: profile/certificate is expired, mismatched, or not an App Store distribution identity", file=sys.stderr)
        sys.exit(1)
