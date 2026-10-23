# Task: Google Sheets backend + GitHub Pages hosting (Antigravity, agent A)

Goal: Homebound runs with **no server**. The web app is hosted on GitHub Pages
(`https://bryanzhao08.github.io/safety-bracelet/`), and a Google Sheet is the database: every entry and exit is
a row the organizer can see live. The Node server keeps working unchanged, and the frontend picks the backend at
runtime.

## You own (touch nothing else)
`sheets/` (new), `web/shared/api.js`, `web/shared/config.js` (new), `web/setup/` (new), `web/t/` (new),
`web/index.html` (new, Pages root), `.github/workflows/pages.yml` (new), `SHEETS.md` (new). Agent B is redesigning
every other file in `web/` at the same time. Don't edit their HTML, CSS or page JS.

## 1. `sheets/Code.gs`: Apps Script web app bound to the organizer's Sheet
- **One Sheet = one event.** The `setup()` function, also offered in a custom "Homebound" menu, creates these tabs
  with header rows:
  - `Guests` (id, name, email, phone, source, dob, over21, idState, idExpires, idHash, idScannedAt, createdAt)
  - `Bands` (token, shortCode, guestId, createdAt)
  - `Scans` (at, direction, shortCode, guestName, guestId, bandToken, monitorName)
  - `Departures` (at, groupId, guestName, guestId, bandToken)
  - `Audit`
  - `Settings`, holding eventName, adminPin (8 digits), monitorCode (6 chars), secret (32 random bytes hex),
    retentionDays = 30
  - It generates the pin, code and secret, and shows the pin and code in an alert.
  - Put the human-readable columns (time, direction, name) first, so the organizer can scan the sheet by eye.
- **`doPost(e)`** parses `JSON.parse(e.postData.contents)` = `{action, auth:{adminPin?|monitorToken?}, ...args}` and
  returns `ContentService.createTextOutput(JSON.stringify(result)).setMimeType(JSON)`. Errors come back as
  `{error, message}` with HTTP 200 (Apps Script can't set status codes), and the client turns them into `ApiError`.
- **Actions** mirror CONTRACT.md:
  - `monitorSession` {monitorCode, name} → `{monitorToken}` (HMAC of name + time with the secret, kept in
    `CacheService`/`PropertiesService` for 24 h)
  - `searchGuests`, `idCheckin`, `scan`, `departures`, `dashboard`, `addGuest`
  - admin only: `event`, `importCsv` (same column auto-detection and status filtering as `server/imports.js`;
    port the logic, and test it against `samples/*.csv`), `createBands`, `bandsCsv`, `timeline`, `updateEvent`,
    `endEvent`
- **Invariants** from CONTRACT.md still hold:
  - Monitor actions never return email or phone.
  - The license number is only used for `idHash = HMAC-SHA256(secret, state + number)` via
    `Utilities.computeHmacSha256Signature`, and is never written to the sheet.
  - Bands in one departure share a groupId.
  - A band links to exactly one guest.
  - The same `Idempotency-Key`-style `requestId` arg returns the cached result (CacheService, 6 h).
- Wrap every write in `LockService.getScriptLock()`.
- **Retention:** `installRetention()` adds a daily trigger that clears the personal rows `retentionDays` after
  `endEvent`.
- `sheets/appsscript.json` manifest: webapp `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`.

## 2. `web/shared/config.js` + backend switch in `api.js`
- `config.js` exports `getBackend()` → `{type:'server'}` or `{type:'sheets', url}`.
  - Sheets mode applies when `localStorage.hb_sheets_url` is set, or when the page URL has
    `?sheet=<encoded Apps Script URL>` (save it, then strip it from the address bar).
  - Default: server mode when the page is served from a host other than `*.github.io`; otherwise sheets mode,
    with no URL yet, so the pages send the user to `../setup/`.
- In `api.js`, keep every exported function's name, arguments and return shape **identical** (agent B's pages call
  them). Internally, sheets mode calls `sheetsCall(action, args)`:
  ```js
  fetch(url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({action, auth, ...args})})
  ```
  `text/plain` avoids the CORS preflight that Apps Script can't answer, and the client follows redirects.
- `openDashboardStream(handlers)`: server mode = SSE as now. Sheets mode = poll `dashboard` every 5 s, call
  `onStats`, and synthesize `onScan`/`onDeparture` for new items. Return the same `{close()}` handle.
- `createEvent` in sheets mode isn't possible from the browser. Throw `ApiError(400,'use_sheet_setup', …)` so the
  admin page can link to setup.
- Fix the other raw `fetch('/api…')` calls you find (`grep -rn "fetch(" web`) by routing them through `api.js`
  exports. If one sits in a file agent B owns, add an export and list the call site in STATUS.md for agent B to
  switch.

## 3. `web/setup/`: "Connect a Google Sheet"
Short steps with a copy button for `Code.gs` (fetch `../../sheets/Code.gs` is NOT on Pages, so the workflow copies
it to `web/setup/Code.gs`):
1. Make a new Google Sheet.
2. Open Extensions → Apps Script, paste the code, and save.
3. Run `setup`.
4. Deploy as a web app (Anyone).
5. Paste the URL here.

After the URL is pasted, test it with a `ping` action. Then show:
- the admin pin and monitor code (read back from `event` with the pin the organizer types)
- a **monitor link** = `../door/?sheet=<url>` with a QR (use `web/shared/qr.js`) to text to door staff

Use agent B's `base.css` classes. Keep your markup plain.

## 4. GitHub Pages
- **Band URLs:** Pages can't do `/t/:token` routes. In sheets mode, band URLs are `<site>/t/?b=<token>`.
  `web/t/index.html` reads `b`, and if a monitor session exists, opens `../door/?band=<token>`. Otherwise it shows
  "This is a Homebound safety band." `createBands` returns these URLs. Make `door.js` accept `?band=` the same
  way it accepts the `/t/` prefill (that's agent B's file: note it in STATUS.md, don't edit it).
- `web/index.html` sends visitors to `site/` (landing), with links to setup, admin, door and dashboard.
- **`.github/workflows/pages.yml`:**
  - on push to main: copy `web/` to `_site/` and `sheets/Code.gs` to `_site/setup/Code.gs`
  - add `.nojekyll`
  - use `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4`, with the
    permissions `pages: write` and `id-token: write`
- `SHEETS.md` covers:
  - the 5-step setup
  - privacy: the Sheet is the organizer's, so they must keep it unshared; anyone with the link to the Apps Script
    still needs the pin or code
  - limits: Apps Script takes about 1–2 s per call and has quotas; fine for parties of a few hundred

## 5. Verify
- `npm test` still passes, because the server is untouched.
- Write `sheets/test/local.test.js` that loads `Code.gs` in Node with tiny fakes for SpreadsheetApp, Utilities,
  LockService, CacheService and ContentService, then runs:
  setup → importCsv(samples/luma_guests.csv) → monitorSession → idCheckin → scan in → departures(2 bands) →
  dashboard.
  It asserts that no email, phone or license number appears in monitor responses or in the fake sheet.
- Append what you did and any notes for agent B to STATUS.md. Don't run git (Claude commits).
