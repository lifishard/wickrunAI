# Repository instructions

## Versioning

User requirement: Every delivered application update must increment the release version. Keep package.json, both root version fields in package-lock.json, and src/lib/version.ts synchronized. Never move or overwrite an existing release tag. The current version lives in src/lib/version.ts (2.20.2 at the time of writing); every delivery must use a new version. Why each harness component exists and when it may be removed: docs/HARNESS_COMPONENTS.md.

## Android preview signing

The published Android 3.0.0 preview used a temporary CI signer whose private key was not retained. The user explicitly chose to keep `dev.anyai.app` and require backup before a manual uninstall/reinstall for 4.0.0. Preserve the fixed local 4.0.0 signing identity for future updates. Never generate a random replacement signer or change the application ID without a new user decision. Keep private signing keys out of Git and uploads. The canonical release pins the native source commit/tag, APK checksum, application ID, and certificate in `config/android-release-source.json`; CI verifies the locally signed candidate and blocks publication if any of the nine packages or Android evidence is missing.

## Shell commands in tests

The development machine is Windows, so tests run under `cmd.exe`. Some verification runs elsewhere under `sh`. A test that shells out must use a command that behaves the same in both: prefer `node -e "..."`. POSIX-only syntax silently changes meaning under `cmd.exe` rather than failing loudly. `echo x; exit 1` is one `echo` there, exit code 0, so a test expecting a failure passes on Linux and misreports on Windows. Keep command output ASCII when a test asserts on it; non-ASCII has to survive the command line and the pipe, and that is a separate failure with the same symptom.

## Working directories

Sessions run in parallel; directories do not. Before a run touches files, read the directory's current state rather than assuming the state you left. Two runs never edit the same directory tree at once: `src/lib/workspace-guard.ts` registers the roots a conversation claims, and a second conversation that wants an overlapping root queues until the first releases it.

Edit files in isolation. Write a new file beside the original when you transform something the user may still want; change a file in place only when the user asked for that file to be changed. Before you merge or hand work back, diff against the baseline you started from and confirm the project still builds and tests clean. Report what you verified. A run that cannot verify says so instead of reporting success.
