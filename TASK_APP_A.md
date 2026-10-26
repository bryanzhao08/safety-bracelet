# Task: Homebound app core library + tests (Antigravity, agent A)

Read `APP_CONTRACT.md` first. It is the spec. Own ONLY `web/app/lib/` and `test/app-*.test.js`.

Build `card.js`, `vault.js`, `store.js` and `nights.js` exactly as specified in "Module API".
- Pure ES modules, no DOM, `globalThis.crypto.subtle` only. They must run unchanged in Safari, Chrome and Node 24.
- Base64url helpers go in a small shared `b64.js` inside `lib/`.
- Times format as "10:42 pm" (lowercase, no leading zero). Night labels look like "Fri, Oct 24". Both take an
  explicit `tzOffsetMin` so tests are deterministic.

## Tests: `node --test test/app-*.test.js`
- **card:**
  - round trip
  - optional keys omitted
  - every invalid field throws `bad_card`
  - unknown keys dropped
  - `parseScan` handles a full URL, a bare value, and garbage (returns `null`)
  - encoded URL under 300 chars for a maximal card
  - vCard contains `FN` and `TEL`
- **vault:**
  - create → seal → unlock → open round trip
  - wrong passcode → `bad_passcode`
  - sealing works with only `meta` (no passcode)
  - `changePasscode`: old entries still open, and the old passcode fails
  - format check on the passcode
  - two seals of the same entry give different ciphertext
- **store:** use an in-memory storage fake.
  - `recordScan` for a new person, then the same person again (`again:true`)
  - `self` and `no_vault` errors
  - **`hb_people` raw JSON contains no ISO timestamps and no `lat`**
  - `wipe` clears every `hb_*` key
- **nights:**
  - noon-to-noon grouping across midnight
  - newest night first
  - 10-min collapse
  - `recap` `lastWith` / `wentHome`
  - `shareText` format

`npm test` must still pass (the old suites plus yours). Append a short note to STATUS.md with the exported names.
Don't run git.
