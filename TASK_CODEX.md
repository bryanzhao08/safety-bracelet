# Codex task (v2, SIMPLER): build `server/` against the NEW CONTRACT.md

The design changed: read ARCHITECTURE.md and CONTRACT.md again. **Drop** guest devices, circles, home-safe alerts,
web push and departures-with-destination. **Build:** events and auth, guests with Luma API import and CSV import
(Partiful and Luma exports; auto-detect columns), bands (+ CSV), scan in/out with guest linking, departure groups
("left together"), dashboard and SSE, export.csv with left-with names, audit log, retention job, tests for the 5
invariants plus a 2,000-guest scan timing test, and `scripts/demo.js` (seeds an event with 40 imported guests
and 40 bands, prints the PIN, the monitor code and 3 band URLs). Reuse whatever you already built that still fits;
delete what doesn't. Luma calls must be mockable in tests (no network in tests). Status note in STATUS.md when done.
