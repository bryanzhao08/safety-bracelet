# Task: Redesign the Homebound frontend (Antigravity, agent B)

Restyle and restructure every page so it feels like one deliberate product, not a template. Keep every behavior
working.

## You own
- every file in `web/admin/`, `web/door/`, `web/dashboard/`, `web/program/`, `web/site/`
- `web/shared/base.css`

Don't touch:
- `web/shared/api.js` or `config.js`
- `web/setup/` or `web/t/`
- `sheets/`
- `server/`

Agent A owns those, and is adding a Google-Sheets backend behind the same `api.js` exports. Call only `api.js`
exports, never `fetch('/api…')` directly.

## Must-do plumbing (the site will be hosted at `/safety-bracelet/` on GitHub Pages)
- **Make every URL relative:** `href="/shared/base.css"` → `../shared/base.css`, `href="/door"` → `../door/`, and
  the same for JS imports and service-worker registration and scope. Check with `grep -rnE '(src|href)="/' web`;
  only external `https://` links may remain.
- **Door accepts `?band=<token>`** exactly like the `/t/<token>` prefill.
- **Admin:**
  - If `createEvent` throws `use_sheet_setup`, show "This site saves to a Google Sheet." with a button to
    `../setup/`.
  - In sheets mode, show an "Open the Google Sheet" link if `api.js` exposes one.
- Read STATUS.md for notes from agent A and act on them.

## Who uses it
- **The door:** a sorority or frat member standing at a party door, at night. A phone in one hand, a guest's ID or
  wrist in the other, loud music and dim light. They need one giant action and an instant, unmistakable result.
- **The dashboard:** the organizer or a sober monitor glancing at a phone or laptop: how many people are inside,
  and who left with whom.
- **Admin:** the organizer, the night before, on a laptop. Calm and clear.
- **The site:** a chapter risk chair deciding whether to pilot it.

## Design plan (follow it; it was reviewed against generic defaults)
**Concept: the wristband.** The disposable Tyvek concert band is the product's physical object, so it becomes
the visual motif. Status chips and roster rows are drawn as **bands**: a long pill with a small perforated tab end
(a CSS `radial-gradient` notch row) in the band's color. Spend the boldness there. Everything else stays quiet.

**Color** (CSS custom properties in `base.css`). The default theme is dark, built for party doors. Add a light
theme for admin and site via `prefers-color-scheme`.
| token | hex | use |
|---|---|---|
| `--night` | `#1B2340` | page background: deep indigo, not black |
| `--panel` | `#252F55` | raised surfaces (use sparingly; prefer spacing over boxes) |
| `--tyvek` | `#F3F5F8` | primary text, the band "paper" |
| `--slate` | `#8E98BA` | secondary text |
| `--band-orange` | `#FF7A1A` | IN / checked in / primary action |
| `--band-pink` | `#FF4FA3` | left together (groups) |
| `--band-lime` | `#C6F432` | 21+ verified (used only on the ID badge) |
| `--stop` | `#FF3B3B` | UNDER 21 / EXPIRED / errors |

**Type:**
- **"Archivo"** (Google Fonts, variable width axis): condensed widths (wdth 62–75) at weights 700–800 for the big
  door verdicts and the dashboard's inside count. Tight tracking and tabular numerals.
- **"Atkinson Hyperlegible Next"** for everything else (built for low-vision legibility, which fits dim rooms).
- Two families only. The type scale is 14 / 16 / 20 / 28 / 44 / 88 px.
- No all-caps eyebrow labels and no monospace labels.

**Layout:**
- **Door (phone):**
  - A full-height screen. The bottom half holds the IN | OUT toggle as two huge thumb targets.
  - After a scan, the whole screen floods with the result color for about 1.2 s, with the name in 88 px Archivo
    condensed, then settles. This is the one orchestrated motion moment, and it should respect
    `prefers-reduced-motion` with a static color fill.
  - "Leaving together" shows the tapped bands stacking as band chips with a running count, plus one "Done, N
    leaving together" button.
  - ID result: a full-width lime / red band reading "21+" / "UNDER 21" / "EXPIRED".
  - Keep the consent line visible in small print at the bottom.
- **Dashboard:**
  - The inside count huge at left/top. Departures as a feed of grouped pink band chips ("Maya, Jess, Priya · left
    together 1:42 am").
  - The roster as rows of band chips (orange = inside, pink = left with someone, slate outline = not arrived),
    searchable.
  - Left-aligned throughout.
- **Admin:** a single column, max 680 px, with the steps as a real sequence (numbered, because it is one):
  create or connect event → import guests → make bands → share door link. Plain words.
- **Site:** the hero is a band chip animating from IN to "left together" with a second chip. The headline is about
  getting everyone home, not "safety platform". No SaaS card grid, gradient washes, or stock "features" triplet.

**Copy:** sentence case, plain verbs, buttons say exactly what they do ("Check in", "Leaving together",
"Export record"). Errors say what happened and what to do.

**Quality floor:**
- 44 px+ touch targets.
- Visible focus ring in band-orange.
- Works at 360 px wide.
- WCAG AA contrast (check slate on night).
- No layout shift on result flashes.

## Verify
- `npm start`, then open each page at `http://localhost:4400/...` and use the demo event (`npm run demo` prints
  the pin and code).
  Check that:
  - every page renders
  - a door check-in works
  - "leaving together" works
  - the dashboard updates
- Also serve `web/` statically from a subfolder:
  ```
  mkdir -p /tmp/hbp/safety-bracelet && cp -r web/* /tmp/hbp/safety-bracelet/ && npx serve /tmp/hbp
  ```
  Confirm no 404s for CSS or JS under `/safety-bracelet/`.
- Take screenshots of door, dashboard, admin and site at 390 px and 1280 px (any headless browser you have) into
  `web/_screens/`. Critique them and fix what looks generic.
- Append a summary to STATUS.md. Don't run git.
