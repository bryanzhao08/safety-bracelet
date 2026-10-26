# Homebound design system v2: "2 a.m. blue" Liquid Glass (owned by Claude)

> **v3 update (2026-10-26):** the palette is now black (#000000) with sky blue (#5AC8FA) and neutral white glass (fill rgba(255,255,255,.08), rim .16). The passcode entry is an iPhone-style keypad (web/app/ui/keypad.js): 6 dots, round 78px glass number keys with letters, and Delete/Cancel text keys.

Subject: phones swapped at a party at night, and checked again the morning after. The UI is a deep, saturated
night blue (not near-black). Liquid Glass is used for **controls and navigation only**, and content sits on its
own clear layer. Two accents with fixed meanings:
- **cyan** means "now" and action
- **dawn** is used only for the morning-after recap and "home"

## Tokens: put them on `:root` in `web/app/app.css` and copy them into `web/site/site.css`
```
--midnight: #000000;  /* page base */
--deep:       #13265C;  /* glow layer under glass */
--ink:        #EAF0FF;  /* primary text (≥ 12:1 on midnight) */
--mist:       #A3B3D9;  /* secondary text (≥ 7:1) */
--signal:     #5AC8FA;  /* primary actions, "met" dots, focus ring */
--dawn:       #FFB38A;  /* morning-after recap, "home" dots: nothing else */
--lilac:      #B9A4FF;  /* notes, party arrivals */
--danger:     #FF6B7A;
--glass-fill: rgba(140,175,255,.10);
--glass-rim:  rgba(190,215,255,.28);   /* 1px top/left highlight border */
--glass-shadow: 0 10px 40px rgba(2,8,30,.55);
--blur: blur(22px) saturate(170%);
```
- **Background:** `body`'s `--midnight` plus two fixed radial glows: `--deep` at the top right (60%) and a faint
  cyan `rgba(92,225,255,.10)` at the bottom left. The glass needs something to refract.
- **Glass recipe:**
  - `background: var(--glass-fill); backdrop-filter: var(--blur); border: 1px solid var(--glass-rim)`
  - an inner top highlight: `inset 0 1px 0 rgba(255,255,255,.18)`
- **Reduced transparency fallback:** `@media (prefers-reduced-transparency: reduce)`, and also when
  `backdrop-filter` is unsupported, glass becomes opaque `#16285A`.
- **Radii have hierarchy, not one value everywhere:**
  - the QR pass: 28px
  - sheets: 24px top corners
  - controls: 999px capsules
  - list rows: 16px

## Type
- **Archivo** (variable, `wdth` 62–100): display, names, times. Big times use `font-stretch: 75%`, weight 700,
  tabular figures.
- **Atkinson Hyperlegible Next:** everything else. It was chosen because the reader may be drunk or tired, so
  legibility is the brand.
- **Scale:** 13 / 15 / 17 (body) / 22 / 30 / 44 / 64.
- **No all-caps labels and no letter-spaced eyebrows.** Remove "YOUR TICKET" and the uppercase "HOMEBOUND" chip.
  Sentence case everywhere, and no `→` on buttons.

## Layout (mobile first, 360–430)
```
┌──────────────────────────────┐
│ Homebound            (gear)  │  ← quiet wordmark, glass gear button
│                              │
│  ╭────────────────────────╮  │
│  │ Maya Kim               │  │  ← the pass: frosted glass, QR on a white
│  │ ig maya.k · sc mayak   │  │    inset "window" (QR must stay black-on-white)
│  │  ┌──────────────────┐  │  │
│  │  │     QR (white)   │  │  │
│  │  └──────────────────┘  │  │
│  ╰────────────────────────╯  │
│  [  Scan theirs  ] (signal)  │
│  [ Face to face ] (glass)    │
│                              │
│   ╭ Swap · People · Night ╮  │  ← floating glass capsule tab bar, 16px off bottom
└──────────────────────────────┘
```
- Content is left-aligned. Only the pass and the passcode keypad are centered.
- **The memorable thing is the pass.** A glass card with a cyan rim light that follows device tilt, using
  `deviceorientation` when permitted, with a static highlight otherwise and under reduced motion. Everything else
  stays quiet.
- **One orchestrated motion:** the scan confirmation. The pass flips to show "Added Jordan" with that person's
  social buttons. Under reduced motion it's a crossfade.

## Socials, shown everywhere a person appears
- Each platform is a glass capsule button with the platform's glyph (inline SVG, monochrome `--ink`) and the
  handle. Tapping it opens the profile URL (`profileUrl`), which iOS and Android hand to the installed app.
- Platforms: Instagram, Snapchat, TikTok, X, LinkedIn. Phone gets Call and Text capsules.

## Copy
Plain verbs, sentence case. Use:
- "Scan theirs", "Face to face", "Added Jordan", "Still with Jordan"
- "Saved to your night", "I'm home", "Add a note"
- "The morning after", "Who you were with"

Never use "blackout". Errors say what happened and what to do: "That code isn't a Homebound card. Ask them to
open their pass."
