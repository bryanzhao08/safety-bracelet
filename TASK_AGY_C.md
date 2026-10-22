# Antigravity C: pilot website (own ONLY web/site/; served at /site and as a static page)
A public one-page site for fraternity/sorority chapters, risk chairs and campus staff:
- Hero: "Know who's inside, and who left together." Sub: NFC wristbands + ID check at the door, a live headcount, and a
  record of who left with whom, deleted after 30 days.
- How it works (3 steps: import your Luma/Partiful list → scan ID and tap a band at the door → tap out together),
  what the organizer sees, privacy (what's stored, what's never stored: license numbers, addresses; 30-day delete;
  logged lookups), hardware (wristband + clip; $0.20 NFC stickers), pricing (pilot free; then per-event or per-semester,
  marked "draft"), FAQ (no app for guests; works on any phone; Android NFC vs iPhone QR), and a pilot sign-up form
  (chapter, school, email, event size) that POSTs to `/api/pilot` if it exists, otherwise stores locally and shows a mailto fallback.
- Same visual system as the app (web/shared/base.css tokens; navy/amber), fast, accessible, no third-party scripts.
Commit as you go if git works; append to STATUS.md.
