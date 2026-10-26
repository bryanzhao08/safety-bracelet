# Task: App v2 core library (Codex)
Read `APP_CONTRACT.md`, especially the "v2 changes" section.

Own ONLY:
- `web/app/lib/`, including a new `party.js`
- `test/app-*.test.js`
- `scripts/app-smoke.mjs`

Two Antigravity agents are rebuilding the UI (`web/app/` outside `lib/`, and `web/site/`) at the same time
against the API in the contract. Ship the API exactly as written.

1. **`vault.js`:**
   - 6–8 digit minimum for `createVault` and the new passcode in `changePasscode`.
   - Legacy 4–5 digit `unlock` still works.
   - Export `isLegacyPasscode`.
2. **`card.js`:**
   - the new social keys (`tt`, `x`, `li`) and the `@` stripping
   - `PLATFORMS`, `parseProfileLink`, `profileUrl`, `shareableCard`
   - `parseScan` returns `{kind,…}`
   - `vcard` includes the social URLs (`X-SOCIALPROFILE` plus a `URL` line)
3. **`party.js`:** `encodeParty`, `decodeParty`, `partyUrl`, per the contract.
4. **`store.js`:**
   - `getParty`, `joinParty`, `leaveParty`, `listHosted`, `saveHosted`, `removeHosted`, `getShare`, `setShare`,
     `homeReminderDue`, `recordHome`, `recordNote`
   - the `partyId` stamp on met entries
   - `wipe` covers the new keys
4b. **`nights.js`:** `arrive` entries; `recap().parties`.
5. **Tests:**
   - update the existing tests for the 6-digit minimum and the new `parseScan` shape
   - add `test/app-v2.test.js`:
     - every `parseProfileLink` URL form, plus garbage
     - `profileUrl` for every platform
     - `shareableCard` filtering
     - party round trip, oversize input and XSS rejection
     - `joinParty` seals an `arrive` and stores no plaintext timestamps beyond the party's own
     - `homeReminderDue` truth table
     - a legacy 4-digit vault still unlocks, and `isLegacyPasscode`
6. **`app-smoke.mjs`:** onboarding uses a 6-digit passcode. Also load a `#party=` URL and assert the banner
   element `[data-party-banner]` appears. Agent B adds that attribute.

`npm test` must pass. Append the exported names to STATUS.md. Don't run git.
