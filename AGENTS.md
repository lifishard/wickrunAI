# Repository instructions

## Versioning

User requirement: Every delivered application update must increment the release version. Keep package.json, both root version fields in package-lock.json, and src/lib/version.ts synchronized. Never move or overwrite an existing release tag. The current change set targets 2.4.0; subsequent updates must use a new version.

## Working directories

Sessions run in parallel; directories do not. Before a run touches files, read the directory's current state rather than assuming the state you left. Two runs never edit the same directory tree at once: `src/lib/workspace-guard.ts` registers the roots a conversation claims, and a second conversation that wants an overlapping root queues until the first releases it.

Edit files in isolation. Write a new file beside the original when you transform something the user may still want; change a file in place only when the user asked for that file to be changed. Before you merge or hand work back, diff against the baseline you started from and confirm the project still builds and tests clean. Report what you verified. A run that cannot verify says so instead of reporting success.
