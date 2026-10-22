# Codex task: build `server/` (see AGENTS.md for rules)

Build the full backend in CONTRACT.md:
1. `server/db.js` creates the SQLite schema (node:sqlite) with indexes, plus `server/tokens.js` (128-bit random tokens, 4-char band
   short codes without ambiguous characters, constant-time compare).
2. `server/index.js`: plain `node:http` router, JSON helpers, cookies (`hb_device` HttpOnly Secure SameSite=Lax; Secure
   off on localhost), static serving of `web/` with the routes in CONTRACT.md, security headers (CSP: self only), rate limits.
3. Every endpoint in CONTRACT.md with the exact request and response shapes and role checks.
4. SSE hub for `/api/monitor/stream` (per event; heartbeat every 20 s).
5. `server/notify.js`: one `notify(target, message)` interface with a web-push implementation (VAPID keys generated on first run
   into `data/vapid.json`, gitignored) and a console fallback.
6. Alert engine and retention job exactly as specified (both testable with an injectable clock).
7. Tests in `test/` (node --test) covering every endpoint's happy path, auth failures, all 5 invariants, the alert timeline
   (+0 / +10 / +20 min with a fake clock) and retention. Add a load test that times 2,000-band door scans.
8. `scripts/demo.js` seeds a demo event with 30 bands, prints the admin PIN, monitor code and 3 band URLs.
`package.json` scripts: `start`, `test`, `demo`. Write a status note to STATUS.md when done.
