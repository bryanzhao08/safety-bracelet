# Task: Homebound app: security tests, smoke harness, README (Codex)

Read `APP_CONTRACT.md` first. It is the spec. Two Antigravity agents are working at the same time:
- agent A builds `web/app/lib/` and `test/app-{card,vault,store,nights}.test.js`
- agent B builds the `web/app/` UI and `web/site/`

Don't edit their files. Own ONLY:
- `test/app-security.test.js`
- `scripts/app-smoke.mjs`
- the `scripts` section of `package.json`
- `README.md`

`web/app/lib/` may not exist yet. Write against the contract's API, then re-run once agent A's files appear
(check STATUS.md).

## 1. `test/app-security.test.js`: adversarial tests of the invariants
- **Tampering:**
  - Flip one byte of a sealed entry's `ct` or `iv` → `open` throws `corrupt`.
  - A tampered `wrapped` → `unlock` throws, and never returns a key.
- **Stored vault meta:**
  - `meta.iter >= 310000`.
  - Neither `meta` nor any stored `hb_*` value contains the private key in plaintext: no `"d":` JWK field, and no
    pkcs8 base64 that matches an exported private key.
- **What's in storage after `recordScan` × 3 with locations:**
  - The raw `hb_log` string contains none of the names, notes, lat/lng digits, or ISO dates.
  - `hb_people` contains no ISO timestamps, `lat` or `lng`.
- **Wrong passcodes:** 50 different wrong passcodes all fail. Don't make this slow: use 3 random ones, plus
  confirming that `unlock` really derives with PBKDF2, by timing or by injecting `iter`.
- **Swapped vaults:** a different vault's private key can't open this vault's entries.
- **Hostile scans:** `decodeCard` rejects:
  - `javascript:` / `<script>` in any field
  - names over 40 chars
  - oversize payloads (> 2 KB)
  - non-JSON

## 2. `scripts/app-smoke.mjs` (`npm run smoke:app`)
- **Setup:**
  - Serve `web/` with a tiny `node:http` static server on a free port.
  - Launch headless Chrome (`/Applications/Google Chrome.app/...`) with `--remote-debugging-port`.
  - Drive it over CDP with Node 24's global `WebSocket`; no puppeteer.
  - Wait until `/json/version` responds; don't use a fixed sleep.
- **Steps:**
  1. Load `/app/`.
  2. Complete onboarding programmatically, or seed it through `lib/store.js` inside the page.
  3. Load two `#add=` URLs.
- **Assert:**
  - No horizontal overflow at 360, 390 and 430 px with mobile emulation (`scrollWidth <= innerWidth`) on `/app/`
    and `/site/`.
  - No network requests to origins other than localhost and fonts.googleapis.com / fonts.gstatic.com.
  - `localStorage.hb_log` has no plaintext names.
  - No console errors.
- Exit non-zero with a clear message on failure.
- Kill Chrome and the server on exit.

## 3. `README.md`
Rewrite it for the new product:
- what it is
- the two layers (public People, private night log)
- the threat model:
  - protects against: someone holding your unlocked phone; the hosting server, which never sees cards because they
    travel in the URL fragment
  - does NOT protect against: malware on the phone, a shoulder-surfed passcode, or 4-digit brute force on a copied
    storage dump (recommend 6+ digits)
- how to install to the Home Screen
- dev commands: `npm test`, `npm run smoke:app`
- "Legacy: the wristband version lives in `server/`, `sheets/`, `cad/`, `pcb/` and is no longer linked."

## Verify
- `npm test` passes once agent A's lib lands.
- `npm run smoke:app` passes once agent B's UI lands. If it fails because of their bugs, write the failing case
  and the cause into STATUS.md under "For agent B", then stop. Don't fix their files.
- Append to STATUS.md. Don't run git.
