# Repository instructions

## Versioning

User requirement: Every delivered application update must increment the release version. Keep package.json, both root version fields in package-lock.json, and src/lib/version.ts synchronized. Never move or overwrite an existing release tag. The current version lives in src/lib/version.ts (2.20.2 at the time of writing); every delivery must use a new version. Why each harness component exists and when it may be removed: docs/HARNESS_COMPONENTS.md.

## Android preview signing

Since 4.0.3 the Android preview is built and signed by CI, not on the developer's PC. The user explicitly chose this and a new signing key (the 4.0.0/4.0.1 local key is retired; installs signed with it must be uninstalled once). The private key lives only in the GitHub secret `ANDROID_SIGNING_BUNDLE` (base64 JSON: keystoreBase64, storePassword, keyAlias, keyPassword) plus the owner's offline backup; it is never in Git, artifacts or logs. `dev.anyai.app` stays the application ID. Never generate or swap a signer, or change the application ID, without a new user decision: the public certificate SHA-256 is pinned in `config/android-release-source.json` and a build signed with any other certificate is refused.

Release rules: the native source is a separate line (tag `android-source-vX.Y.Z[-rN]`, created by CI from the pinned commit if missing, never moved). `.github/workflows/android-build.yml` builds, signs and verifies the APK. Android never blocks the desktop release: the three desktop builds are required, and the APK is attached only if complete and matching the pinned certificate; otherwise the Release notes say it is missing and `release-android.yml` (or re-running the failed job) attaches it later without touching published desktop files. Every version bump needs `config/android-release-source.json` and the Android line updated to the same version.

## README release sections

The README home page lists only highlights and major updates, each in the 4.0.0 section format (one intro paragraph, bold-led bullets, a closing paragraph linking the release notes). Small patch releases go only in `docs/releases/vX.Y.Z.md`, never as a README section. Release notes link to other files with full URLs so they work on the GitHub Release page.

## Shell commands in tests

The development machine is Windows, so tests run under `cmd.exe`. Some verification runs elsewhere under `sh`. A test that shells out must use a command that behaves the same in both: prefer `node -e "..."`. POSIX-only syntax silently changes meaning under `cmd.exe` rather than failing loudly. `echo x; exit 1` is one `echo` there, exit code 0, so a test expecting a failure passes on Linux and misreports on Windows. Keep command output ASCII when a test asserts on it; non-ASCII has to survive the command line and the pipe, and that is a separate failure with the same symptom.

## Working directories

Sessions run in parallel; directories do not. Before a run touches files, read the directory's current state rather than assuming the state you left. Two runs never edit the same directory tree at once: `src/lib/workspace-guard.ts` registers the roots a conversation claims, and a second conversation that wants an overlapping root queues until the first releases it.

Edit files in isolation. Write a new file beside the original when you transform something the user may still want; change a file in place only when the user asked for that file to be changed. Before you merge or hand work back, diff against the baseline you started from and confirm the project still builds and tests clean. Report what you verified. A run that cannot verify says so instead of reporting success.
