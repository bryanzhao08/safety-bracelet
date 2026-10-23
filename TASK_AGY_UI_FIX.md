# Task: UI fix pass (Antigravity). You own the same files as TASK_AGY_UI.md.

Claude reviewed `web/_screens/` and found the problems below. Fix all of them, then re-screenshot and check each
one visually.

1. **Door overflows at 390 px:** the inputs and the "Start Door Shift" button run off the right edge. Look for a
   fixed width, `100vw` plus padding, or a missing `box-sizing`. Nothing on any page may scroll sideways at
   360–390 px.
2. **Door `?band=<token>`:** `door.js` doesn't handle it yet (grep finds no `band=`). It must prefill exactly like
   the `/t/<token>` path; `web/t/index.html` redirects here.
3. **Fonts:** the screenshots render in Helvetica, so Archivo and Atkinson Hyperlegible Next aren't applied.
   - Check that every page's `<link>` loads them.
   - Check that `--font-display` / `--font-sans` name them first.
   - Use Archivo at `font-stretch: 75%` (or `font-variation-settings: "wdth" 75`), weight 800, for the door
     verdicts, the big inside count and the site headline.
   - Screenshot after `document.fonts.ready`.
4. **Admin step 1:**
   - The number "1" and the "Step 1" pill say the same thing twice; keep only the number.
   - Drop the "Starts At *" asterisks (all three are required).
   - The "log into existing event" fields are crammed together with no gaps, and their placeholders are
     letter-spaced caps ("P I N", "DOOR CODE (OPTIONAL)"). Make it a quieter secondary block: the heading
     "Already made an event?", normal spacing, and sentence-case placeholders with no letter-spacing.
   - Rename the buttons "Create event" and "Open event".
5. **Admin, other steps:** the same treatment. Steps are numbered because they are a sequence; don't add pills or
   eyebrows.
6. **Site hero:** the demo panel is mostly empty space with one band.
   - Show the actual motif: two band chips ("Maya" and "Jess") that start orange as "Inside 11:15 pm" and, on page
     load, slide together and turn pink as "Left together 1:42 am".
   - One orchestrated animation; under `prefers-reduced-motion`, show the end state.
   - Remove the "→" from button text, and the " · " joined meta strings in the hero.
7. **Copy:**
   - Use sentence case on all buttons and headings ("Start door shift", "Door scanner", "Live dashboard").
   - No "→" glyphs appended to links.
8. **Dashboard:** after joining, check that the inside count uses the Archivo display style and that the roster
   rows render as band chips (orange inside, pink left together, slate outline not arrived). Screenshot it *after*
   joining the demo event: `npm run demo` prints the event ID and monitor code, and `npm start` serves it.
9. Apply the switches agent A noted in STATUS.md, for `site.js` (`submitPilot`) and `program.js` (`getBandsCsv`),
   if they aren't done already.

Verify:
- `npm test` passes.
- No `(src|href)="/` absolute paths remain.
- Re-screenshot door, dashboard (joined), admin and site at 390 and 1280 into `web/_screens/`.

Append a short summary to STATUS.md. Don't run git. Don't stop until the screenshots are re-taken and you've
looked at them.
