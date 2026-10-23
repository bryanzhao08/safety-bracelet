# Task: Door scanner screen redesign (Antigravity). Own ONLY `web/door/` (and `web/door/sw.js`: bump `CACHE_NAME` to `hb-door-v4`).

Keep the Liquid Glass look from TASK_AGY_GLASS.md and all behavior (NFC, QR, code entry, ID scan, offline queue,
"leaving together"). Claude screenshotted the logged-in door at 390 × 844 and found these problems.

1. **The center of the screen is empty.** The main job, tapping a wristband, has no visual target.
   - Fill the middle with a large **tap zone**: a big rounded glass ring or band shape with a soft pulse in the
     current mode's color (orange for IN, pink for OUT) and one line: "Hold a band to the phone" on Android with
     NFC; on iPhone or without NFC: "Scan the band's QR or type its code".
   - The pulse is static under `prefers-reduced-motion`.
   - The tap zone is also a button that opens the camera QR scanner.
2. **Action hierarchy, top to bottom:**
   - In IN mode, "Scan ID" is the first step, so make it a solid primary orange button, not muddy glass.
   - In OUT mode, hide Scan ID and show the "Leaving together" tray in that spot: the tapped bands stack as pink
     band chips with a count, and two buttons: "Leaving alone" and "Done, N leaving together".
3. **Code row:**
   - The "Check in" button wraps onto 2 lines. Make it single-line ("Check in" / "Check out" by mode), with enough
     width.
   - The code placeholder is letter-spaced caps "CODE". Use a normal placeholder: "4-letter code". Keep the
     uppercase transform only for typed input.
4. **Mode toggle:**
   - Confirm that tapping OUT actually switches mode. Claude's automated click didn't visibly switch it, so make
     sure the buttons have real `<button>` elements with `data-mode="in"|"out"` and `aria-pressed`.
   - The whole screen's accent (tap zone, primary button) follows the mode color.
5. **Link-band sheet** (shown when an unlinked band is scanned):
   - The title is "Link band ZVAP" in sentence case.
   - Guest rows are currently gray chips with near-invisible "Tap to Link" pills. Make each row a full-width glass
     row with the name in 16 px, and the whole row tappable.
   - Drop the inner pill; show a subtle chevron instead.
   - Add a search box at the top (one exists; make sure it filters).
   - Keep "+ Add walk-in guest", relabeled "Add walk-in guest".
6. **Header:** "Homebound Demo / Monitor: Sam" is fine. Make Dashboard and Exit compact glass capsules, and add
   a small online/offline dot (queued-scan count when offline).
7. **Result flash:** keep it solid full-screen and readable (name in Archivo condensed at 64–88 px).

## Verify
- `npm start` and `npm run demo` (prints the event ID and monitor code).
- Use Chrome DevTools Protocol mobile emulation at 390 × 844; `--window-size` alone does not emulate a phone.
  Log in, then screenshot to `web/_screens/door2-*.png`:
  - IN mode
  - OUT mode with 2 bands tapped (type demo band codes)
  - the link-band sheet
  - a check-in result
- Look at each one, fix what's off, and check that nothing scrolls sideways.
- `npm test` passes.
- Append to STATUS.md. Don't run git.
