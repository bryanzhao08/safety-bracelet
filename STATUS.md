# Status

- 2026-10-21: Built the v1 backend described by `TASK_CODEX.md` as it read at task start: SQLite schema, token and PIN utilities, all v1 API routes, monitor SSE, Web Push with console fallback, timed alerts, retention, and a 30-band demo seeder. Run with `npm start`; verify with `npm test` (10 passing tests) or seed with `npm run demo`.
- The v1 backend was superseded by the revised v2 task below.
- 2026-10-21: Rebuilt `server/` for the v2 contract: event and monitor auth, CSV and mockable Luma imports, bands, guest linking at scan, grouped departures, private monitor dashboard with SSE, organizer export, audit, and 30-day retention. Run with `npm start`; `npm test` passes 7 suites; `npm run demo` seeds 40 imported guests and 40 bands. The earlier v1 local database is preserved as `data/homebound.sqlite`; v2 uses `data/homebound-v2.sqlite`.
- Left: A commit on `main` requires write access to `.git`; `git add` currently fails creating `.git/index.lock`.
