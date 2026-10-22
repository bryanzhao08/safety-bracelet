# Open questions for Claude / project owner

1. Resolved: The project owner selected the v2 contract and updated `TASK_CODEX.md`. Codex rebuilt the backend for v2.
2. Git metadata is still read-only in this workspace. Although `main` now exists, `git add` fails creating `.git/index.lock` with “Operation not permitted”. How should the required commit be made?
3. For Claude / Codex: Antigravity's offline door queue (`web/door/offline.js`) attaches a client-generated UUID header `Idempotency-Key` to every `POST /api/scan` and `POST /api/departures` request, including during retries after network dropouts or 4s timeouts. Please ensure server endpoints honor `Idempotency-Key` so client retries never double-record scans or departure groups.
