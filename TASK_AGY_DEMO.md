# Task: In-browser sample event + guest meetups on Sheets (Antigravity, agent A).

Own ONLY:
- `sheets/`
- `web/shared/api.js`, `web/shared/config.js`, `web/shared/demo-backend.js` (new)
- `web/t/`, `web/setup/`

## 1. Try-it-now sample event (no server, no Google Sheet)
The user wants to open the GitHub Pages site and test the whole flow immediately.
- `config.js`: a new backend `{type:'demo'}`, active when `localStorage.hb_demo === '1'` or the URL has
  `?demo=1` (save it, then strip it from the address bar). Export `startDemo()` and `exitDemo()`.
- **`demo-backend.js`: run the real `sheets/Code.gs` in the browser**, so demo mode behaves exactly like the
  Sheets backend.
  - Load the Code.gs text with `fetch('../setup/Code.gs')` (the Pages workflow already copies it there; also keep
    `web/setup/Code.gs` in sync for the Node server).
  - Evaluate it with `new Function` inside a scope of fakes: SpreadsheetApp, Utilities, LockService,
    CacheService, ContentService, PropertiesService, Session.
  - The spreadsheet fake keeps tabs as arrays and persists to `localStorage.hb_demo_sheet`.
  - `Utilities.computeHmacSha256Signature` needs a synchronous HMAC-SHA256: include a small pure-JS SHA-256 (no
    CDN).
  - Port the fakes from `sheets/test/local.test.js` so the two stay consistent.
  - The function returns `sheetsCall`-compatible results.
- **`startDemo()` seeds a realistic party:**
  - "Sample party: Friday 10 pm"
  - 24 guests with diverse first and last names
  - 30 bands
  - about 12 checked in over the last 2 hours, 2 groups that left together, and 4 meetups
  - It sets an admin session with a known PIN `00000000` and door code `DEMO42`, and a monitor session named
    "You", so every page works immediately with nothing to type.
- **`api.js`:** route demo mode through the in-browser backend exactly like sheets mode. `createEvent` in demo
  mode resets and reseeds.
- **Show a demo banner:** export `isDemo()` so pages can show "Sample event. Nothing here is real." with an
  "Exit sample" button (agent B adds the banner UI).

## 2. Meetups in the Sheets backend
- **`Code.gs`:**
  - an `Interactions` tab (at, aName, bName, bandA, bandB, guestA, guestB, source)
  - a public `meet` action following CONTRACT.md "Guest meetups": inside check, 5-min dedupe, 30/hour per band
    via CacheService, first-name-only response
  - `timeline` includes met events, `dashboard` roster adds `meetups`, and retention clears Interactions
- **`api.js`:** a new export `recordMeetup(myBandToken, theirBandToken)` working in all three backends (server
  `POST /api/meet`).
- Extend `sheets/test/local.test.js` with meet cases (happy path, not_inside, dedupe, first-name only).

## 3. `web/t/`: the guest tap page
It works at `t/?b=<token>` and at `/t/<token>` on the Node server, where the token is the last path segment.
- **A monitor session exists:** keep the current behavior (open the door with the band).
- **Otherwise, the guest flow,** with `localStorage.hb_my_band`:
  - **No band saved:** "Is this your wristband?" with the button "Yes, this is my band". Saving it shows: "Saved.
    Tap your phone to a friend's band to log that you met."
  - **Own band:** "This is your band."
  - **Another band:** call `recordMeetup` immediately. Show "You met Jess · 12:10 am" big, in the Liquid Glass
    style, with a pink band chip.
  - **Errors:** `not_inside` → "Check in at the door first." Rate limit → "Too many taps. Try again later."
  - A small "Not my band? Reset" link.
  - A one-line privacy note: "Logged for the host's safety record only. Deleted after 30 days."
- Style it with `../shared/base.css` glass tokens, and use relative URLs.

## Verify
- `node --test sheets/test/local.test.js` passes.
- Open `localhost:4400/site/?demo=1` style flows and check that door, dashboard, admin and `t/?b=<a demo token>`
  all work in demo mode without the server's API: add `?demo=1`; demo mode must take priority over server mode.
- `npm test` passes.
- Append to STATUS.md, including the exported names agent B should use (`isDemo`, `startDemo`, `exitDemo`). Don't
  run git.
