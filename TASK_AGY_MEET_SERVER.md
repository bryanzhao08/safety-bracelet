# Task: Guest meetups on the Node server (Antigravity, agent C). Own ONLY `server/` and `test/`.

Implement the new "Guest meetups" section and invariant 6 of CONTRACT.md:
- **`db.js`:** add the `interactions` table (migration-safe: `CREATE TABLE IF NOT EXISTS`) with indexes on
  `(eventId, bandA)` and `(eventId, bandB)`.
- **`POST /api/meet {myBandToken, theirBandToken, at?}`**, public:
  - Validate per the contract: same event, both linked, tapper inside → otherwise `409 not_inside`. A band can't
    meet itself (400).
  - The same unordered pair within 5 min returns the existing row.
  - 30 per band per hour → 429.
  - Response `{ok, at, with:{firstName}}`.
  - Accepts `Idempotency-Key` like the other POSTs.
  - Writes an audit row.
- **`/t/:bandToken`:** keep the monitor-session behavior. Otherwise serve `web/t/index.html` with the token
  available, so that page can run the guest flow. Make `web/t/index.html` work at `/t/<token>` too (Agent A builds
  that page; coordinate through STATUS.md, and don't edit `web/`).
- **Timeline:** add `{type:'met', at, detail:{with}}` for both guests.
- **Export CSV:** add a `met` column ("Jess 12:10 am; Priya 1:02 am").
- **Dashboard roster:** add `meetups:int`.
- **Retention:** delete interactions.
- **Tests:** add `test/meet.test.js` covering:
  - happy path
  - `not_inside`
  - self-meet
  - 5-min dedupe
  - rate limit
  - first-name-only response (no surname, email or phone anywhere in the body)
  - timeline and export contents
  - retention clears interactions
- `npm test` must pass.
- Append to STATUS.md. Don't run git.
