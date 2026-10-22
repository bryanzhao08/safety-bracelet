# Homebound: architecture

**What it is.** A safety layer for parties (fraternity and sorority chapters first). Guests get an NFC +
QR wristband. Sober monitors tap bands at the door going in and out. Guests can say who they're leaving
with and get a "home safe?" check-in that alerts **their own chosen friends** if they don't answer.
Monitors get a live headcount, "still inside at close", and discreet help requests.

**The one rule that shapes everything: guests own their departure data.**

| Who | Can see |
|---|---|
| Organizers and monitors | Headcount, capacity, which **band codes** are still inside, help requests. Names only if the guest typed one, and only while they're inside. **Never who left with whom.** |
| The guest | Their own entry, exit, departure note and check-ins |
| The guest's circle | Only what the guest shares: "Maya left at 1:12 am with Jordan, heading home", then "home safe ✅" or an alert |
| Everyone | All event data auto-deletes 48 hours after the event ends, unless the **guest** flags an incident. Flagging preserves only that guest's own records. |

## Pilot scope (v1, web only, no app install)

The pilot runs on any phone. iPhones read NFC URL tags natively (tap a band and Safari opens the
link), and every phone camera can scan the QR printed on the band.

```
 Wristband (NFC tag + printed QR)  →  https://HOST/b/<bandToken>
          │
          ├─ Guest taps own band ──► Guest PWA  /b/<token>   link band → device, set circle, "I'm leaving", "Home safe", Help
          │
          └─ Monitor scans band ───► Door app   /door        entry / exit taps (camera QR on any phone, Web NFC on Android)
                                     Monitor    /monitor     live headcount, inside-at-close, help queue (SSE)
                                     Organizer  /admin       create event, print bands, invite monitors, incident log
 Circle member (a friend) ─────────► /c/<circleToken>        sees only what the guest shares; gets web push / SMS later

                         ┌──────────────────────────────────────────┐
 all clients ── JSON ──► │ server/  Node 24, plain http, node:sqlite │ ── SSE ──► monitor dashboards
                         │  • api routes (CONTRACT.md)               │
                         │  • alert engine (home-safe timers)         │ ── Web Push (VAPID) ──► guest + circle
                         │  • retention job (48 h delete)             │
                         └──────────────────────────────────────────┘
```

### Components and owners

| Path | What | Owner |
|---|---|---|
| `server/` | API, SQLite schema, access rules, alert engine, retention job, web push, static hosting of `web/`, tests | **Codex** |
| `web/guest/`, `web/circle/` | Guest PWA (band link, circle, leaving flow, home-safe, help) and the circle page | **Antigravity** |
| `web/door/`, `web/monitor/`, `web/admin/` | Door scanner, monitor dashboard, organizer admin and band printing | **Antigravity** |
| `web/shared/` | `api.js` (fetch wrappers for every endpoint in CONTRACT.md), `ui.css` design tokens | **Antigravity** (must follow CONTRACT.md exactly) |
| `ARCHITECTURE.md`, `CONTRACT.md`, `AGENTS.md`, `GEMINI.md` | Architecture and contracts | **Claude**. Agents read them and never edit them; ask instead. |

### Tech choices (and why)
- **Node 24, zero or few deps, `node:sqlite`:** one process, one file DB, runs on a laptop at the party or any
  small host (Fly, Render, Railway). Allowed deps: `web-push` only.
- **Plain HTML, CSS and ES modules for the web, no build step:** loads instantly on bad party Wi-Fi, and agents can't
  break a bundler.
- **SSE for monitors** (simple, works through proxies). **Web Push** for guests and circles (free, no SMS account
  needed for the pilot). SMS via Twilio is a later adapter behind the same `notify()` interface.
- **Tokens, not accounts, for guests:** `bandToken` (128-bit random, in the NFC/QR URL) plus `deviceToken`
  (HttpOnly cookie, set the first time a phone opens a band). Organizers and monitors use event codes and PINs
  in v1, and magic-link email later.

## Key flows

1. **Organizer** creates an event, gets an admin PIN and a monitor join code, and generates N bands (a printable
   sheet of QR codes plus a CSV of URLs to write to NFC tags).
2. **Entry:** a monitor scans the band, `POST /api/door/scan {direction:"in"}`, and the band is now inside. Optional: the
   guest taps their own band to link their phone, set a first name and add their circle.
3. **Help:** the guest taps Help (or scans the "Need help?" QR posted on walls). A help request goes to the monitor
   dashboard instantly (SSE) and is acknowledged and resolved there. No 911 auto-call; there's a big "Call 911"
   link for the guest.
4. **Leaving:** a monitor scans the band out, or the guest taps "I'm leaving". The guest's phone asks: heading
   home? leaving with (optional, free text)? expected time home (default from a travel-time picker)? Which of my
   circle should know (default: all)? The circle gets notified.
5. **Home safe:** at `expectedHomeAt` the server pushes "Home safe?" to the guest. If there's no answer after
   10 minutes it nudges again. After 20 minutes it **alerts the circle** ("Maya hasn't checked in. Last shared:
   left 1:12 am with Jordan"). Any "home safe" closes it out.
6. **Close:** the monitor sees "N bands still inside" with codes and first names, and does a walkthrough.
7. **Retention:** 48 hours after `endsAt`, presence, departures, circles, devices and push subscriptions for that
   event are deleted. Only help requests, without guest identity, are kept as an incident log for the organizer.
   A guest can tap "Keep my records" (incident flag), which preserves **only their own** records for 30 days, and
   only they can export them.

## Security and privacy baseline
- **Tokens:** random 128-bit tokens, compared in constant time. Rate limits on scan and help endpoints.
- **Cookies and headers:** HttpOnly, Secure, SameSite=Lax cookies; CSP header; no third-party scripts or
  analytics in the guest or circle pages.
- **Departure data** is only readable by the guest's device and that guest's circle tokens. **No organizer endpoint
  returns `leavingWith`.** Tests enforce this.
- **Audit log** for organizer actions.
- **Minimal data:** no phone numbers or emails in v1. Circles are invite links the guest shares themselves.

## Out of scope for the pilot
Native iOS door app (Core NFC), SMS, organizer accounts and billing, multiple venues per event, analytics.
