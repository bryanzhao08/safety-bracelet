# Antigravity task: build `web/` (see GEMINI.md for rules)

Build every web screen against the API in CONTRACT.md (the server is being built in parallel by Codex; use
`web/shared/api.js` for all calls so endpoint shapes live in one place). Plain HTML, CSS and ES modules, no build step.

Design: calm and trustworthy, readable at night. A dark navy background (#0f1630), warm off-white text, one accent
(#ffb44c amber), with green for "home safe" and red only for Help. Large type (≥ 18 px body), big buttons (≥ 56 px).
System font stack. No third-party scripts, fonts or analytics.

1. `web/shared/api.js` (one function per endpoint) and `web/shared/ui.css` (tokens, buttons, cards, toasts).
2. `web/guest/index.html` at /b/<bandToken>. First open: "This is your band". Optional first name, then **My people** (create a circle
   and share its invite link via the Web Share API, falling back to copy), and turn on notifications (web push).
   During the party: a big **I'm leaving** and a red **Get help** that's always visible. Leaving flow: heading home / to a friend /
   other; leaving with (optional); time to get home (15 / 30 / 45 / 60 min picker); who should know (checkboxes). After leaving:
   a big green **I'm home safe** with a countdown. Also: "Keep my records" and "Delete my data" explained in plain words.
3. `web/circle/index.html` at /c/<circleToken>: what your friend shared (left at, with, expected home), live status, and opt in to notifications.
4. `web/door/index.html`: join with event id and monitor code, then a full-screen scanner. Camera QR scanning (use BarcodeDetector when
   available, otherwise vendor a small QR decoder into web/shared/vendor/, MIT-licensed), Web NFC on Android Chrome, and manual
   short-code entry. Big IN / OUT toggle, a giant green or amber result flash plus a vibration, scan → result in under 1 s.
5. `web/monitor/index.html`: live headcount and capacity bar, help queue (ack / resolve) with a loud visual alert, a "still inside" list
   (short code and first name only), all live via SSE.
6. `web/admin/index.html`: create an event (shows the admin PIN and monitor code once, and tells the organizer to save them), generate
   bands, a **printable band sheet** (QR plus short code, print CSS), CSV download, an incident log and End event.
Never show departure details on door, monitor or admin pages. Write a status note to STATUS.md when done.
