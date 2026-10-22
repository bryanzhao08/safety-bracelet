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
guests(id PK, eventId, name, email NULL, phone NULL, source 'luma'|'partiful'|'manual', externalId NULL, createdAt)
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

**Monitor (door + dashboard)**
- `GET /api/guests?q=` → name search `[{id, name, band?, inside}]` (no email or phone)
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

## Invariants (tests)
1. Monitor endpoints never return email or phone.
2. Two or more bands in one departure share a groupId; the export lists each person's group-mates.
3. A band links to exactly one guest per event; relinking needs admin.
4. Retention deletes all personal rows.
5. Scan is under 50 ms with 2,000 guests.
