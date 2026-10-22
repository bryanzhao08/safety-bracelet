# Status

- 2026-10-21: Built the v1 backend described by `TASK_CODEX.md` as it read at task start: SQLite schema, token and PIN utilities, all v1 API routes, monitor SSE, Web Push with console fallback, timed alerts, retention, and a 30-band demo seeder. Run with `npm start`; verify with `npm test` (10 passing tests) or seed with `npm run demo`.
- Next: resolve the v1/v2 specification conflict recorded in `QUESTIONS.md`. `ARCHITECTURE.md` and `CONTRACT.md` now describe v2, so the current backend does not satisfy those revised documents. Git commits also require write access to `.git`.
