# Antigravity A: door reliability (own ONLY web/door/ and web/program/; read web/shared/api.js but don't edit it)
1. **Offline scan queue** (`web/door/offline.js`): if a scan or departure POST fails (offline or timeout over 4 s), store it in
   IndexedDB with its client timestamp and show "Saved offline (3 waiting)". Retry with backoff and on `online` events,
   in order, and never double-submit (client UUID per action, sent as header `Idempotency-Key`). The UI must still show
   the green/amber result instantly from local state where possible. Add a tiny service worker (`web/door/sw.js`) so the
   door page loads with no network after the first visit.
2. **Band programmer** (`web/program/index.html`, route /program): admin enters event id + PIN, loads the bands CSV,
   then writes each URL onto blank NTAG stickers with Web NFC `NDEFReader.write({records:[{recordType:'url', data:url}]})`
   (Android Chrome). Show "Hold sticker #K7QM to the phone" → ✓, auto-advance, skip, rewrite, and a progress counter.
   On iPhone, show "Use an Android phone or an NFC writer app (e.g. NFC Tools) with the CSV".
3. Note in QUESTIONS.md that the server should honor `Idempotency-Key` (Claude will route it to Codex). Commit as you go
   if git works; append to STATUS.md.
