# Homebound: contract (server ↔ web)

All JSON. Times are ISO-8601 UTC strings. Errors: `{ "error": "<code>", "message": "<human text>" }` with
an HTTP status. Port `process.env.PORT || 4400`. The server also serves `web/` statically:
- `/` → `web/admin/` landing
- `/b/:bandToken` → `web/guest/index.html`
- `/c/:circleToken` → `web/circle/index.html`
- `/door`, `/monitor`, `/admin` → their folders
- `/shared/*` → `web/shared/*`

## Auth

| Role | How | Sent as |
|---|---|---|
| Organizer | `adminPin` (8 digits) returned once at event creation | header `X-Admin-Pin` + `eventId` in the path |
| Monitor | `monitorCode` (6 chars) → `POST /api/events/:eventId/monitor-session` → `monitorToken` | header `Authorization: Bearer <monitorToken>` |
| Guest | first `GET /api/bands/:bandToken` sets the HttpOnly cookie `hb_device` (random token) and links the band to that device if the band is unlinked | cookie |
| Circle member | `circleToken` in the URL | path |

A band linked to another device returns `403 band_linked_elsewhere` for guest actions, but still works for door scans.

## Data model (SQLite)

```
events(id TEXT PK, name, org, startsAt, endsAt, capacity INT NULL, adminPinHash, monitorCode,
       retentionHours INT DEFAULT 48, createdAt)
bands(token TEXT PK, eventId, shortCode TEXT UNIQUE-per-event (4 chars, e.g. "K7QM"), deviceId NULL,
      displayName NULL, createdAt)
presence(id PK, bandToken, eventId, direction 'in'|'out', at, by 'monitor'|'guest')
devices(id TEXT PK, createdAt, lastSeenAt)
circles(token TEXT PK, deviceId, eventId, label (e.g. "Roommates"), createdAt)
circle_members(id PK, circleToken, nickname NULL, pushSubscription JSON NULL, joinedAt)
departures(id PK, bandToken, eventId, deviceId, leftAt, leavingWith TEXT NULL, destination 'home'|'friend'|'other',
           expectedHomeAt, sharedWith JSON (circle tokens), status 'active'|'home'|'alerted'|'cancelled', homeAt NULL)
help_requests(id PK, eventId, bandShortCode NULL, note NULL, location NULL, createdAt, status 'open'|'ack'|'resolved',
              ackBy NULL, resolvedAt NULL, resolution NULL)
guest_push(deviceId, subscription JSON)
incident_holds(deviceId, eventId, until)       -- "Keep my records"
audit(id PK, eventId, actor, action, at, detail JSON)
```

## Endpoints

### Organizer
- `POST /api/events` with `{name, org, startsAt, endsAt, capacity?}` returns `201 {eventId, adminPin, monitorCode}`
- `GET  /api/events/:eventId` (admin) returns `{event, stats:{bands, inside, entered, exited, openHelp}}`
- `POST /api/events/:eventId/bands` (admin) with `{count}` (max 2000) returns `{bands:[{token, shortCode, url}]}`
- `GET  /api/events/:eventId/bands.csv` (admin) returns CSV `shortCode,url` for NFC writing and printing
- `GET  /api/events/:eventId/incidents` (admin) returns help requests (no guest identity beyond band short code)
- `POST /api/events/:eventId/end` (admin) sets `endsAt` to now (starts the retention clock)

### Monitor
- `POST /api/events/:eventId/monitor-session` with `{monitorCode, name}` returns `{monitorToken, event:{id,name}}`
- `POST /api/door/scan` with `{bandToken | shortCode, direction:'in'|'out'|'toggle'}` returns `{band:{shortCode, displayName?}, inside:boolean, at, warning?:'already_inside'|'not_inside'|'capacity'}`
- `GET  /api/monitor/state` returns `{event, inside:N, capacity, insideBands:[{shortCode, displayName?, since}], help:[...open/ack]}`
- `POST /api/monitor/help/:id/ack` and `POST /api/monitor/help/:id/resolve {resolution}`
- `GET  /api/monitor/stream` (SSE) with events: `scan` `{shortCode, direction, inside}`, `help` `{helpRequest}`,
  `help_update`, `stats` `{inside, entered, exited}`. Auth via `?token=` query (EventSource can't send headers).

### Guest (cookie)
- `GET  /api/bands/:bandToken` links on first open and returns `{band:{shortCode, displayName}, event:{id,name,endsAt}, inside, mine:true, circles:[...], activeDeparture?}`
- `PUT  /api/bands/:bandToken/name` with `{displayName}` (≤ 24 chars, optional)
- `POST /api/circles` with `{eventId, label}` returns `{circleToken, inviteUrl}` (the guest shares `inviteUrl` themselves)
- `DELETE /api/circles/:circleToken`
- `POST /api/push/guest` with `{subscription}`
- `POST /api/departures` with `{bandToken, leavingWith?, destination, expectedHomeAt, sharedWith?:[circleToken]}` returns `{departure}`. Also records presence `out` (by guest) if inside, and notifies the shared circles.
- `POST /api/departures/:id/home` (marks home safe and notifies the circles) and `POST /api/departures/:id/cancel`
- `POST /api/help` with `{eventId, bandToken?, note?, location?}` returns `{id}`. Rate limit: 3 per device per 10 min. Also allowed without a cookie (wall QR).
- `POST /api/holds` with `{eventId}` ("Keep my records") and `GET /api/me/export` (the guest's own data)

### Circle member
- `GET  /api/circles/:circleToken` returns `{label, guestName?, event:{name}, departures:[{leftAt, leavingWith?, destination, expectedHomeAt, status, homeAt?}]}`. Only departures that shared this circle.
- `POST /api/circles/:circleToken/join` with `{nickname?, subscription?}` (push opt-in)

### Alert engine (server internal, runs every 30 s)
For each `active` departure: at `expectedHomeAt` push "Home safe? Tap to confirm" to the guest. At +10 min,
push again. At +20 min set status `alerted` and push to every shared circle member: "<name or 'Your friend'> hasn't
checked in. Last shared: left <time><, with X>". After `home`, push "<name> is home safe ✅" to those circles.

### Retention job (every 10 min)
For events where `now > endsAt + retentionHours`, delete presence, departures, circles, circle_members,
guest_push, band↔device links and display names for that event. Keep `help_requests` with `bandShortCode`
set to NULL. Guests with an `incident_holds` row keep their own departures until `until`.

## Invariants (tests must cover)
1. No organizer or monitor endpoint ever returns `leavingWith`, `destination`, circle data or device ids.
2. A circle token only sees departures that listed it in `sharedWith`.
3. A guest device can't act on a band linked to another device.
4. Retention deletes everything listed, and keeps only anonymized help requests.
5. Door scan is under 50 ms server time with 2,000 bands.
