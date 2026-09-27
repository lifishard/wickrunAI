#!/bin/bash
# Run after npm run mobile:prepare -- ios. Never upload to App Store Connect here.
set +x
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-simulator}"
if [[ "$mode" != simulator && "$mode" != app-store ]]; then
  echo 'Expected simulator or app-store' >&2; exit 1
fi
if [[ "$(uname -s)" != Darwin ]]; then echo 'iOS builds require macOS and Xcode' >&2; exit 1; fi
xcode_version="$(xcodebuild -version | head -n 1 | awk '{print $2}')"
sdk_version="$(xcrun --sdk iphoneos --show-sdk-version)"
if (( ${xcode_version%%.*} < 26 || ${sdk_version%%.*} < 26 )); then
  echo 'Xcode 26+ and iOS 26+ SDK are required' >&2; exit 1
fi
echo "Using Xcode $xcode_version and iOS SDK $sdk_version"
workspace='ios/App/App.xcworkspace'
project='ios/App/App.xcodeproj/project.pbxproj'
[[ -d "$workspace" && -f "$project" ]] || { echo 'Run mobile:prepare -- ios first' >&2; exit 1; }
output="$PWD/release/ios"
mkdir -p "$output"
if [[ "$mode" == simulator ]]; then
  xcodebuild -workspace "$workspace" -scheme App -configuration Debug \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$output/simulator" IPHONEOS_DEPLOYMENT_TARGET=15.0 CODE_SIGNING_ALLOWED=NO build
  simulator_apps=("$output/simulator/Build/Products/Debug-iphonesimulator/"*.app)
  [[ ${#simulator_apps[@]} -eq 1 && -d "${simulator_apps[0]}" ]] || { echo 'Expected one simulator application' >&2; exit 1; }
  ditto -c -k --sequesterRsrc --keepParent "${simulator_apps[0]}" "$output/wickrunAI-ios-simulator.zip"
  exit 0
fi

for name in APPLE_TEAM_ID IOS_DISTRIBUTION_P12_BASE64 IOS_DISTRIBUTION_P12_PASSWORD IOS_PROVISION_PROFILE_BASE64 RUNNER_TEMP; do
  [[ -n "${!name:-}" ]] || { echo "Missing $name" >&2; exit 1; }
done
# CocoaPods installs xcodeproj; only the App target receives profile settings, never Pods.
ruby -rxcodeproj -e 'exit 0'
bundle_id="$(node -p "require('./ios/App/App/capacitor.config.json').appId")"
signing_dir="$(mktemp -d "$RUNNER_TEMP/wickrun-ios-signing.XXXXXX")"
keychain="$signing_dir/signing.keychain-db"
profile_installed=''
keychain_created=false
project_backup="$signing_dir/project.pbxproj"
cp "$project" "$project_backup"
security list-keychains -d user > "$signing_dir/original-keychains.txt"
cleanup() {
  code=$?
  trap - EXIT
  set +e
  cp "$project_backup" "$project"
  [[ -z "$profile_installed" ]] || rm -f "$profile_installed"
  if [[ "$keychain_created" == true ]]; then security delete-keychain "$keychain" >/dev/null 2>&1; fi
  python3 - "$signing_dir/original-keychains.txt" <<'PY'
import pathlib, shlex, subprocess, sys
paths = shlex.split(pathlib.Path(sys.argv[1]).read_text())
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *paths], check=True)
PY
  rm -rf "$signing_dir"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
python3 - "$signing_dir" <<'PY'
import base64, os, pathlib, sys
directory = pathlib.Path(sys.argv[1])
for variable, name in [('IOS_DISTRIBUTION_P12_BASE64', 'certificate.p12'), ('IOS_PROVISION_PROFILE_BASE64', 'profile.mobileprovision')]:
    try:
        data = base64.b64decode(''.join(os.environ[variable].split()), validate=True)
        if not data: raise ValueError()
    except ValueError:
        sys.exit('Invalid base64 signing secret: ' + variable)
    target = directory / name
    target.write_bytes(data)
    target.chmod(0o600)
PY
keychain_password="$(openssl rand -hex 24)"
echo "::add-mask::$keychain_password"
security create-keychain -p "$keychain_password" "$keychain"
keychain_created=true
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$signing_dir/certificate.p12" -P "$IOS_DISTRIBUTION_P12_PASSWORD" -k "$keychain" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
python3 - "$signing_dir/original-keychains.txt" "$keychain" <<'PY'
import pathlib, shlex, subprocess, sys
paths = shlex.split(pathlib.Path(sys.argv[1]).read_text())
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', sys.argv[2], *paths], check=True)
PY
security find-identity -v -p codesigning "$keychain" > "$signing_dir/identities.txt"
security cms -D -i "$signing_dir/profile.mobileprovision" > "$signing_dir/profile.plist"
python3 scripts/ios-profile.py "$signing_dir/profile.plist" "$signing_dir/identities.txt" "$APPLE_TEAM_ID" "$bundle_id" "$signing_dir"
profile_uuid="$(node -p "require(process.argv[1]).uuid" "$signing_dir/profile.json")"
# Xcode 16+ uses this location. The runner is disposable; never overwrite a profile.
profile_directory="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profile_directory"
profile_target="$profile_directory/$profile_uuid.mobileprovision"
[[ ! -e "$profile_target" ]] || { echo 'Profile already exists; refusing to overwrite it' >&2; exit 1; }
cp "$signing_dir/profile.mobileprovision" "$profile_target"
profile_installed="$profile_target"
ruby -rjson -rxcodeproj - "$signing_dir/profile.json" <<'RUBY'
settings = JSON.parse(File.read(ARGV[0]))
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
raise 'Expected only the Capacitor App application target' unless project.targets.length == 1 && project.targets[0].name == 'App'
target = project.targets[0]
target.build_configurations.each do |configuration|
  next unless configuration.name == 'Release'
  configuration.build_settings['CODE_SIGN_STYLE'] = 'Manual'
  configuration.build_settings['DEVELOPMENT_TEAM'] = settings.fetch('teamId')
  configuration.build_settings['CODE_SIGN_IDENTITY'] = settings.fetch('certificateSha1')
  configuration.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = settings.fetch('uuid')
end
project.save
RUBY
archive="$output/wickrunAI.xcarchive"
[[ ! -e "$archive" && ! -e "$output/app-store" ]] || { echo 'Archive output already exists; use a clean runner' >&2; exit 1; }
xcodebuild -workspace "$workspace" -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$archive" -derivedDataPath "$output/archive-build" IPHONEOS_DEPLOYMENT_TARGET=15.0 archive
xcodebuild -exportArchive -archivePath "$archive" -exportPath "$output/app-store" -exportOptionsPlist "$signing_dir/ExportOptions.plist"
# Verify the exported app, not merely the intermediate archive.
ipa_files=("$output/app-store/"*.ipa)
[[ ${#ipa_files[@]} -eq 1 && -f "${ipa_files[0]}" ]] || { echo 'Expected one exported IPA' >&2; exit 1; }
ditto -x -k "${ipa_files[0]}" "$signing_dir/exported"
apps=("$signing_dir/exported/Payload/"*.app)
[[ ${#apps[@]} -eq 1 && -d "${apps[0]}" ]] || { echo 'Expected one exported application' >&2; exit 1; }
codesign --verify --deep --strict "${apps[0]}"
codesign --display --entitlements :- "${apps[0]}" > "$signing_dir/exported-entitlements.plist" 2>/dev/null
python3 - "${apps[0]}/Info.plist" "$signing_dir/exported-entitlements.plist" "$bundle_id" "$output/ios-signing-verification.json" <<'PY'
import json, os, pathlib, plistlib, sys
info = plistlib.loads(pathlib.Path(sys.argv[1]).read_bytes())
entitlements = plistlib.loads(pathlib.Path(sys.argv[2]).read_bytes())
version = json.loads(pathlib.Path('package.json').read_text())['version']
team, bundle = os.environ['APPLE_TEAM_ID'], sys.argv[3]
if info.get('CFBundleIdentifier') != bundle or info.get('CFBundleShortVersionString') != version or not info.get('CFBundleVersion'):
    sys.exit('Exported IPA bundle/version does not match the source release')
if entitlements.get('application-identifier') != team + '.' + bundle or entitlements.get('com.apple.developer.team-identifier') != team or entitlements.get('get-task-allow') is not False:
    sys.exit('Exported IPA signing entitlements do not match App Store distribution')
pathlib.Path(sys.argv[4]).write_text(json.dumps({'bundleId': bundle, 'version': version, 'buildNumber': info['CFBundleVersion'], 'teamId': team, 'method': 'app-store-connect', 'uploaded': False}, indent=2) + '\n')
PY
ditto -c -k --sequesterRsrc --keepParent "$archive" "$output/wickrunAI-ios-archive.zip"
echo 'App Store archive and IPA exported and verified. No upload was performed.'
