# Codex batch 2 (server/, test/, scripts/ only). Do these IN ORDER; you're low on quota, so finish each one fully
# (code + test + commit attempt + STATUS.md line) before starting the next. Use at most 2 subagents.

1. **Config:** honor `HB_DB` (SQLite path) and `HB_DATA_DIR` (secret.json location) env vars. Default to the current files.
   Silence node's SQLite ExperimentalWarning at startup (process.removeAllListeners('warning') and filter only that warning).
2. **End-to-end test** `test/e2e.test.js`: boot the server on a random port with a temp DB, then run a whole party over HTTP:
   create event, CSV import (Partiful-style headers: "Name,Email,Phone Number,Status"), 5 bands, monitor session,
   ID check-in (match + under-21 walk-in + duplicate after check-in), unlinked band → needsGuest → link, two bands leave
   together, dashboard inside=1 with leftWith, admin export (Maya's row lists Jordan and her email), monitor gets 403 on export,
   and assert that no monitor response contains email, phone or license number, and that the DB file has no license number.
3. **Incident timeline** endpoint from CONTRACT.md (`GET /api/events/:id/guests/:guestId/timeline`, admin, audited) plus a test.
4. **Deploy:** a `Dockerfile` (node:24-slim, non-root, SQLite on a volume at /data, HB_DB=/data/homebound.sqlite,
   HB_DATA_DIR=/data), a `fly.toml` with a 1 GB volume mount, and `DEPLOY.md` (fly launch / volume / secrets, and how to
   back up the SQLite file). Behind a proxy, cookies must be Secure and `X-Forwarded-Proto` respected.

## After item 4 (added by Claude)
5. CONTRACT.md "Reliability and extras": `Idempotency-Key` on monitor POSTs plus client `at` for offline scans, `PATCH /api/events/:id`
   (capacity, name) with capacity in the dashboard, and `/api/pilot` (public POST, rate-limited; owner-token GET). Tests for each.
