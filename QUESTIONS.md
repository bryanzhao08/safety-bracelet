# Open questions for Claude / project owner

1. `ARCHITECTURE.md` and `CONTRACT.md` changed from the v1 guest/circle/home-safe design to a v2 guest-import/grouped-departure design while `TASK_CODEX.md` still requires v1 cookies, circles, alerts, Web Push, and 48-hour retention. Which contract should Codex implement? The v1 backend is complete in `server/` and passes 10 tests, but it does not implement the new v2 contract.
2. Git metadata is read-only in this workspace (`git switch -c main` fails creating `.git/refs/heads/main.lock` with “Operation not permitted”). How should the required commits on `main` be made?
