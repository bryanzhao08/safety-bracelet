# Antigravity task (v2, SIMPLER): build `web/` against the NEW CONTRACT.md

Screens (plain HTML/CSS/ES modules, `web/shared/api.js` for every call, no third-party scripts):
1. `web/door/`: join (event id + monitor code + your name), then a full-screen scanner with a huge **IN / OUT** switch.
   Reads bands by Web NFC (Android Chrome; NDEF URL `/t/<token>`), the camera QR (BarcodeDetector or a small vendored
   MIT decoder), or a typed 4-char code.
   - **IN:** if the band isn't linked, show a big searchable guest list (and "Add walk-in"), tap a name to link. Green flash "✓ Maya in".
   - **OUT:** each scanned band joins a "Leaving" tray. Two buttons: **Leaving alone** (each separately) and
     **Leaving together** (one group). A 30 s timer auto-submits. Amber flash "Maya + Jordan left together".
   - The consent line is always shown small at the bottom: "We log check-in/out and who you leave with for safety; deleted after 30 days."
2. `web/dashboard/`: live (SSE) inside / checked-in / left counts, a roster table with search and a status filter, recent
   departures with groups ("Maya + Jordan · 1:12 am"), "Still inside" for closing time. Monitors see names only.
3. `web/admin/`: create an event (show the PIN and monitor code once), connect Luma (API key + event id) or upload a Partiful/Luma CSV,
   generate bands, a printable band sheet (QR + short code; print CSS), a CSV for writing NFC tags, export.csv, and End event.
Design: dark navy (#0f1630), off-white text, amber accent (#ffb44c), big targets (≥ 56 px), readable in a dark doorway.
Delete the old guest/circle/monitor folders if you started them. Status note in STATUS.md when done.
