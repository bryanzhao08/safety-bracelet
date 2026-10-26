# Homebound app: contract (owned by Claude)

The product has pivoted. There is no wristband. Homebound is now a phone app (an installable PWA on GitHub Pages)
for **swapping contact info at a party**.

Under that public layer is a **private night log**: an encrypted, on-device timeline of who you met and when
(and optionally where). The morning after, especially after a blackout, you can see who you were with, when, and
how to reach them.

- **No server.** Everything lives on the phone. Nothing about the log ever leaves the device unless the user
  shares or exports it.
- **App URL:** `web/app/` (Pages: `/app/`). The landing site `web/site/` links to it.
- **Old bracelet code is unlinked, not deleted:** `server/`, `sheets/`, door, dashboard, admin, pilot, program,
  `t/`, `cad/` and `pcb/` stay in the repo but nothing new links to them, and nothing new imports from them except
  `web/shared/qr.js` and `web/shared/vendor/zxing/`.

## Two layers
| Layer | What | Storage | Visible without passcode |
|---|---|---|---|
| People (public) | Contact cards you've swapped: name, phone, Instagram, Snapchat, email | `localStorage hb_people`, plaintext, **no timestamps** | yes, sorted by name |
| Night log (private) | Timestamped entries: met / saw again / note / home, optional location | `hb_log`, each entry sealed with the vault public key | no, needs the passcode |

The app can **append** to the log while it's locked (public-key sealing), but only the passcode can **read** it.
Someone holding an unlocked phone sees the contacts but not who was met when or where.

## Swap flow
1. Each user's QR encodes the URL `<app base>#add=<card>`, where `<card>` is the base64url of the compact JSON
   `{"v":1,"id":"<10 base32 chars>","n":"Maya","p":"+15551234567","ig":"maya.k","sc":"mayak","e":"m@x.com"}`.
   Optional keys are omitted when empty. Keep the encoded URL under 300 chars.
   - Using the fragment means the GitHub Pages server never sees the card.
2. Scanning in-app (back camera, or "Face to face": your QR plus the front camera at the same time) **or** with the
   phone's native camera (it opens the app URL) gives the app a card. The app then:
   - **Validates** it with `decodeCard`. Ignores your own id.
   - **New person:** adds them to People and seals `{type:'met'}` into the log.
   - **Already known:** seals `{type:'met', again:true}` ("Still with Jordan"). Always seal; `nights.js` collapses
     met entries for the same person within 10 minutes at read time. The plaintext side never records when
     someone was last seen.
   - Updates the stored card if fields changed.
   - Shows "Added Jordan" with call, text and Instagram actions, and a "Have them scan you too" hint showing your
     QR.
3. If location is enabled in Settings (off by default), each sealed entry gets `loc:{lat,lng,acc}` from one
   low-accuracy `getCurrentPosition` with a 4 s timeout. On failure, the entry has no loc. There is no reverse
   geocoding and no third-party calls.

## Night log entries (plaintext shape, before sealing)
```
{ id, type:'met',  at:ISO, personId, name, again?:true, loc? }
{ id, type:'note', at:ISO, text (≤280), loc? }          // "at Sigma Chi", "left with Priya"
{ id, type:'home', at:ISO, loc? }                       // "I'm home" button
```

## Module API: `web/app/lib/` (agent A)
They must be environment-neutral ES modules (browser plus Node 24 tests) using `globalThis.crypto`, with no DOM.
Storage is injected: any `{getItem,setItem,removeItem}`.

**`card.js`**
- `newId()` → 10-char base32 string
- `encodeCard(card)` → base64url
- `decodeCard(str)` → card, or throws `Error('bad_card')`. Validates and trims:
  - `n` is 1–40 chars
  - `p` matches `^\+?[0-9 ()-]{7,20}$`
  - `ig` and `sc` match `^[A-Za-z0-9._]{1,30}$`
  - `e` is a basic email
  - Unknown keys are dropped.
- `cardUrl(base, card)` → `${base}#add=${encodeCard(card)}`
- `parseScan(text)` → card or `null`. Accepts a full URL with `#add=`, or a bare base64url.
- `vcard(card)` → a vCard 3.0 string, for "Save to Contacts"

**`vault.js`**: ECDH P-256 + AES-GCM-256, PBKDF2-SHA256 at 310000 iterations.
- `createVault(passcode)` → `meta` = `{v:1, salt, iter, pub:JWK, wrapped:{iv,ct}}`. The private key is pkcs8,
  AES-GCM-wrapped with the PBKDF2 key.
- `seal(meta, entry)` → `{epk:JWK, iv, ct}`. Generates an ephemeral ECDH key, derives an AES key with HKDF or
  directly with `deriveKey`, and encrypts the JSON. No passcode needed.
- `unlock(meta, passcode)` → `CryptoKey` (the private key). Throws `Error('bad_passcode')`.
- `open(privKey, sealed)` → entry. Throws `Error('corrupt')`.
- `changePasscode(meta, oldPass, newPass)` → new meta, with the same keypair, so old entries still open.
- Passcodes are 4–8 digits; anything else throws `Error('bad_passcode_format')`.

**`store.js`**: `createStore(storage)` returns:
- `getMe()` / `setMe(card)` for `hb_me`
- `listPeople()`, sorted by name / `getPerson(id)` / `upsertPerson(card)` / `removePerson(id)` for `hb_people`
- `getVault()` / `setVault(meta)` for `hb_vault`
- `appendSealed(sealed)` / `listSealed()` / `replaceLog(arr)` for `hb_log`
- `getSettings()` / `setSettings(patch)` for `hb_settings` (`{location:false, autoLockMin:5}`)
- `wipe()` removes every `hb_*` key.
- `recordScan({card, me, loc, now})` does steps 2–3 above and returns `{person, isNew}`.
  - If `card.id === me.id` it throws `Error('self')`.
  - It seals using the stored vault meta.
  - If no vault exists yet, it throws `Error('no_vault')`; the UI forces vault setup during onboarding.

**`nights.js`**
- `groupByNight(entries, {tzOffsetMin})` → `[{key:'2026-10-24', label:'Fri, Oct 24', entries:[…sorted]}]`, newest
  night first. A night runs **noon to noon** local time.
- Collapses `met` entries for the same person within 10 min, keeping the first.
- `recap(night)` → `{people: n distinct, first:at, last:at, lastWith:{personId,name,at}|null, wentHome:at|null}`.
- `shareText(night)` → plain text ("Fri, Oct 24\n10:42 pm met Jordan\n…\n2:15 am home") for `navigator.share`.

## UI (agent B): `web/app/`
- **Onboarding:**
  1. Your card: name required; phone, Instagram, Snapchat, email optional.
  2. Choose a passcode for the night log. Show a warning: "If you forget it, the log can't be recovered."
- **Tabs:**
  - **Swap:** home screen, your QR card.
  - **People.**
  - **Night:** lock icon; passcode to open; auto-locks after `autoLockMin` minutes or when the tab is hidden; the
    key is kept in memory only.
- **Night view:**
  - Morning recap at top: "Last night you were with 6 people. Last with Priya at 2:15 am." with a "Text Priya"
    button.
  - A vertical timeline per night.
  - "Add a note" and "I'm home" buttons. These seal while locked too, from the Swap screen's small "…" menu, so a
    drunk user doesn't need the passcode to log.
  - "Share this night", "Download log" (decrypted JSON after unlock).
- **Settings:** edit your card, location on/off, change passcode, "Delete everything" (confirm).
- **PWA:**
  - `manifest.webmanifest` and icons
  - `sw.js` with cache `hb-app-v1`, cache-first for same-origin, skipping cross-origin
  - an iOS "Add to Home Screen" hint, shown once
- **`#add=` on load:** process it, then `history.replaceState` to strip the fragment.
- **Your QR:** use `generateQRSvg` from `../shared/qr.js`.
- **Scanner:** a copy of `../shared/qr-scanner.js` at `web/app/ui/scanner.js`, extended with a `facingMode` option.
  It uses the vendored ZXing at `../shared/vendor/zxing/zxing.min.js`.

## Invariants
1. No network requests from `web/app/` except same-origin static files. No analytics and no CDNs (Google Fonts
   from base.css is the only exception).
2. Log entries are only ever stored sealed. Plaintext entries exist in memory only while unlocked.
3. `hb_people` never contains timestamps or locations.
4. Forgotten passcode: the only reset is "Delete everything".
