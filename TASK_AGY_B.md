# Antigravity B: organizer tools (own ONLY web/admin/, web/dashboard/ and web/shared/api.js)
1. **Incident timeline** in admin: search a guest → call `GET /api/events/:id/guests/:guestId/timeline` (CONTRACT.md;
   Codex is building it now) → a vertical timeline (ID checked · in · out · left with Jordan Lee (phone)) and a
   "Last seen inside" line, with a print view. Show a one-line notice that the lookup is logged. Add the function to api.js.
2. **Dashboard upgrades:** a capacity bar with an amber warning at 90% and red at 100% (capacity set in admin, stored
   on the event if the server supports it, otherwise localStorage), a "Closing time" mode that lists everyone still
   inside in big text with a printable checklist, a sound and vibration on each new departure group, and auto-reconnect
   for SSE with a visible "Live / Reconnecting" pill.
3. **Admin polish:** the band sheet as Avery-style 2"x1" labels (QR + short code) as well as the current sheet; a Luma
   connect form with clear help text on where to find the API key; and after creating an event, a single "Copy all details"
   button (event id, admin PIN, monitor code, door link). Commit as you go if git works; append to STATUS.md.
