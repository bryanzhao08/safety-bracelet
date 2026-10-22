# Homebound: architecture (v2, simple)

**What it is.** NFC wristbands for parties. Every guest gets a band at the door. Monitors tap it on the way
in and out. Bands tapped out together are recorded as **left together**. The organizer has a full record
(who came, when they left, and who they left with) to follow up and keep people safe. The guest list comes
from **Luma** (API) or **Partiful** (CSV export).

```
 Luma API / Partiful CSV ──► import guests (name, email, phone)
                                   │
 Door phone (monitor) ── tap band ─┼─► server ──► SQLite (guests, bands, scans, departures)
   • IN:  scan ID barcode (PDF417 on back of US licenses) → name, 21+ check, guest-list match → tap band to link
          (no ID? search the guest list by name instead)
   • OUT: tap band(s) → "Leaving alone" or "Leaving together" (tap 2+ bands within 30 s = one group)
                                   │
 Monitor/organizer dashboard ◄─ SSE ─ live: inside count, roster, recent exits with groups, who's still inside
```

## Components and owners
| Path | What | Owner |
|---|---|---|
| `server/` | API, SQLite, Luma + CSV import, scans, departure groups, SSE, CSV export, retention, tests | **Codex** |
| `web/door/` | Phone door scanner: Web NFC (Android Chrome) + camera QR fallback + manual short code; IN / OUT modes; "Together" grouping | **Antigravity** |
| `web/dashboard/` | Organizer and monitor dashboard: inside count, roster search, departures with groups, still-inside at close, export | **Antigravity** |
| `web/admin/` | Create event, connect Luma or upload a Partiful CSV, generate bands (QR sheet + NFC CSV), settings | **Antigravity** |
| `cad/` | Wristband NFC-tag clip (CadQuery → STEP for Onshape + STL for printing) | **Claude** |

**Dropped from v1:** the guest app, circles, home-safe check-ins and web push. They can come back later as an add-on.

## Rules
- **Hardware:** NTAG213/215 NFC stickers or ready-made NFC Tyvek or silicone wristbands. Each tag holds the URL
  `https://HOST/t/<bandToken>` plus a printed 4-character short code. **iPhones can't read NFC from a web page**, so
  iPhone door scanning uses the QR or the code. Android Chrome reads NFC directly. A native iOS scanner can come later.
- **Data the organizer keeps:** guest name, email and phone (from the import), band, every in/out scan time,
  departure groups. Access needs the event's admin PIN, or the monitor code for door and dashboard (monitors see
  names and groups but not emails or phones). Every export and lookup is written to an audit log.
- **Consent:** the door screen shows a one-line notice to read to guests ("We log check-in/out and who you leave
  with for safety; deleted after 30 days").
- **Retention:** everything for an event is deleted `retentionDays` (default 30) after the event ends.

## ID scanning
- **Format:** US driver's licenses and state IDs carry an **AAMVA PDF417** barcode. The door page decodes it with the camera:
  `BarcodeDetector({formats:['pdf417']})` where supported (Android Chrome), otherwise vendored **ZXing JS** (Apache-2.0)
  in `web/shared/vendor/`. AAMVA fields are parsed on the device: DCS last name, DAC first name, DBB date of birth,
  DBA expiry, DAJ state, DAQ number.
- **Data minimization:** only name, DOB, state, expiry and the license number go to the server, and the number is turned
  into an event-scoped HMAC and discarded. No address, no photo, no raw barcode stored.
- **Shown at the door:** a big 21+ / UNDER 21 / EXPIRED badge, the guest-list match (or walk-in), and a duplicate-entry warning.
- **Legal:** some states restrict retention of scanned license data (e.g. California Civil Code 1798.90.1). Confirm before launch.
