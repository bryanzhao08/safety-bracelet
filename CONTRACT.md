# Homebound: contract v2 (server ↔ web)

JSON everywhere, ISO UTC times, errors `{error, message}`. Port `PORT || 4400`. The server serves `web/`:
`/` → `web/admin/`, `/door`, `/dashboard`, `/admin`, `/shared/*`. `/t/:bandToken` (what a phone opens when it reads
a band) → `web/door/` with the token prefilled when a monitor session exists, otherwise a page saying "This is a
Homebound safety band".

## Auth
- **Organizer:** header `X-Admin-Pin` (8 digits, returned once at event creation).
- **Monitor:** `POST /api/events/:id/monitor-session {monitorCode, name}` → `{monitorToken}`, then
  `Authorization: Bearer <token>` (SSE: `?token=`).

## Data model (node:sqlite)
```
events(id PK, name, startsAt, endsAt, adminPinHash, monitorCode, retentionDays INT DEFAULT 30,
       lumaEventId NULL, lumaApiKeyEnc NULL, createdAt)
guests(id PK, eventId, name, email NULL, phone NULL, source 'luma'|'partiful'|'manual'|'id', externalId NULL, createdAt,
       dob NULL (YYYY-MM-DD), over21 INT NULL, idState NULL, idExpires NULL, idHash NULL, idScannedAt NULL)
       -- idHash = HMAC-SHA256(serverSecret, eventId + state + licenseNumber); never store the raw number, address or photo
bands(token PK, eventId, shortCode (4 chars, unique per event), guestId NULL, createdAt)
scans(id PK, eventId, bandToken, guestId NULL, direction 'in'|'out', at, monitorName)
departures(id PK, eventId, groupId, guestId NULL, bandToken, at)   -- one row per person; same groupId = left together
audit(id PK, eventId, actor, action, at, detail JSON)
```

## Endpoints
**Organizer**
- `POST /api/events {name, startsAt, endsAt}` → `201 {eventId, adminPin, monitorCode}`
- `GET /api/events/:id` (admin) → `{event, stats:{guests, bands, inside, checkedIn, left, groups}}`
- `POST /api/events/:id/import/luma {apiKey, lumaEventId}` (admin) pulls the approved guests through the Luma
  public API (`GET https://public-api.lu.ma/public/v1/event/get-guests?event_api_id=…`, header
  `x-luma-api-key`, paginated). The key is stored encrypted with a server secret. → `{imported, updated}`
- `POST /api/events/:id/import/csv` (admin, `text/csv` body) accepts Partiful and Luma CSV exports, auto-detecting the
  name, email and phone columns → `{imported, skipped}`
- `POST /api/events/:id/guests {name, email?, phone?}` (admin or monitor): walk-in guest
- `POST /api/events/:id/bands {count}` (admin, ≤ 2000) → `{bands:[{token, shortCode, url}]}`; `GET …/bands.csv` →
  `shortCode,url`
- `GET /api/events/:id/export.csv` (admin) → one row per guest: name, email, phone, band, first in, last out, left
  with (names in the same group). Audited.
- `POST /api/events/:id/end` (admin)
- `GET /api/events/:id/guests/:guestId/timeline` (admin) → `{guest:{name, email, phone, over21?, idState?}, band?,
  events:[{at, type:'in'|'out'|'departure'|'id_check', detail}], leftWith:[{name, phone?}], lastSeenInsideAt?}`.
  Used for incident follow-up ("who was Maya last with?"). Every call is audited. Never includes license data.

**ID scan at check-in** (the door phone decodes the barcode and parses AAMVA fields on the device, then sends only these fields)
- `POST /api/id-checkin {firstName, lastName, dob, idState, idExpires, licenseNumber}` (monitor) → the server computes `idHash`
  (the license number is used only for the hash and then discarded), `over21` and `expired`, and finds a match among the event's guests
  (case-insensitive full-name match, then fuzzy first+last match; returns candidates if ambiguous).
  → `{guest?:{id,name}, candidates?:[{id,name}], created?:true, over21, expired, duplicate?:{guestId, at}}`
  (`created` = walk-in guest made from the ID when there's no match and the event allows walk-ins; `duplicate` = same idHash
  already checked in tonight). The door then links a band with `POST /api/scan {…, direction:'in', guestId}`.

**Monitor (door + dashboard)**
- `GET /api/guests?q=` → name search `[{id, name, band?, inside, over21?}]` (no email or phone)
- `POST /api/scan {bandToken|shortCode, direction:'in'|'out', guestId?}`:
  - `in`, band unlinked, no guestId → `{needsGuest:true, band:{shortCode}}` (the door UI then searches or picks a guest
    and re-posts with guestId, which links the band)
  - `in` → `{guest:{id,name}, inside:true, at, warning?:'already_inside'}`
  - `out` → `{guest, inside:false, at, warning?:'not_inside'}` (records an exit, not a departure group yet)
- `POST /api/departures {bandTokens:[…] | shortCodes:[…]}` → `{groupId, people:[{name}]}`: one call per leaving party
  (1 band = left alone, 2+ = left together). Also records `out` scans for any band still inside.
- `GET /api/dashboard` → `{event, inside, checkedIn, left, roster:[{name, band, status:'inside'|'left'|'not_arrived',
  inAt?, outAt?, leftWith?:[names]}], recentDepartures:[{at, people:[names]}]}`
- `GET /api/dashboard/stream` (SSE) with events `scan`, `departure`, `stats`

**Retention job** (hourly): deletes guests, bands, scans and departures, and keeps a summary row
(counts only) in audit, `retentionDays` after `endsAt`.

**Reliability and extras**
- All monitor POSTs accept an `Idempotency-Key` header (≤ 64 chars). The same key with the same route returns the original
  response without re-applying it (keys kept 48 h). Offline door scans use the client timestamp `at` if provided (±12 h of now).
- `PATCH /api/events/:id {capacity?:int, name?}` (admin). `capacity` is also returned in `GET /api/dashboard`.
- `POST /api/pilot {chapter, school, email, eventSize?, note?}` (public, rate-limited 5/hour/IP) stores pilot sign-ups;
  `GET /api/pilot` (header `X-Owner-Token` = env `HB_OWNER_TOKEN`) lists them.

## Invariants (tests)
1. Monitor endpoints never return email or phone; nothing ever returns or stores a raw license number or address.
2. Two or more bands in one departure share a groupId; the export lists each person's group-mates.
3. A band links to exactly one guest per event; relinking needs admin.
4. Retention deletes all personal rows.
5. Scan is under 50 ms with 2,000 guests.
