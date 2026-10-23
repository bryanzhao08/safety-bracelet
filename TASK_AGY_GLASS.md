# Task: Liquid Glass restyle (Antigravity). You own the same files as TASK_AGY_UI.md.

The user wants the UI to look like Apple's **Liquid Glass**: translucent, refractive surfaces floating over a
living, colorful background. Keep the indigo night palette, the wristband chips, the type and all behavior. This
pass changes the **surfaces**, not the layout or logic.

## Background (the color the glass bends)
- In `base.css`, `body` gets a fixed backdrop: the `--night` base plus 3 large, soft, blurred blobs in band colors
  (orange, pink, and a little lime at about 35% opacity). They drift very slowly (60 s loop).
- The blobs are static under `prefers-reduced-motion`.
- Build them with a `body::before` holding radial-gradients. No images.

## Glass material (one set of tokens, used everywhere)
```css
--glass-bg: rgba(255,255,255,0.08);
--glass-bg-strong: rgba(255,255,255,0.14);
--glass-border: rgba(255,255,255,0.18);
--glass-blur: blur(24px) saturate(180%);
--glass-highlight: inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(255,255,255,0.06);
--glass-shadow: 0 8px 32px rgba(8,12,30,0.35);
```
- **Class `.glass`:**
  - `background: var(--glass-bg)`, `backdrop-filter` + `-webkit-backdrop-filter: var(--glass-blur)`
  - 1px `--glass-border`, `box-shadow: var(--glass-highlight), var(--glass-shadow)`, radius 28px
  - a `::before` specular sheen: a diagonal linear-gradient from `rgba(255,255,255,.18)` to transparent over the
    top-left 40%, with `pointer-events:none`
- **Apply it** to:
  - cards and panels, admin steps, the dashboard roster and departures panels
  - the door login card, modals, and the site's hero demo panel
- **Top bars:** sticky glass with `--glass-bg-strong`.
- **Buttons:**
  - Secondary buttons = small glass capsules (radius 999px).
  - The primary button stays solid band-orange, with the same inset highlight so it looks like a glossy pill.
- **Inputs:** glass with a darker tint, `rgba(10,14,35,0.35)`. On focus, a band-orange glow ring.
- **Segmented controls** (the door IN|OUT toggle, the dashboard roster filters): a glass track with a solid
  glass "thumb" that slides between options with a 250 ms spring (`cubic-bezier(.3,1.4,.5,1)`). This answers a
  user action, so motion is welcome.
- **Band chips:** keep them solid colored (they are the physical object), and add a soft inner top highlight so
  they look like glossy Tyvek.

## Don't break
- **Door result flash:** stays a solid full-screen color. Readability at a dark door beats style, so no glass
  there. The giant IN/OUT buttons may be glass with a solid colored active state.
- **Contrast:** text on glass must hit WCAG AA against the darkest blob. Add a darker tint where it doesn't.
- **Fallback:** `@supports not (backdrop-filter: blur(1px))` → use the opaque `--panel` color.
- **Performance:** at most about 6 blurred layers visible at once on the door page; no nested backdrop-filters.
- Keep relative URLs.
- `npm test` must pass.

## Verify
- `npm start` and `npm run demo`.
- Screenshot door, dashboard (joined with the demo event ID and code), admin and site at 390 × 844 using real
  mobile emulation (Chrome DevTools Protocol `Emulation.setDeviceMetricsOverride`, mobile:true), and at 1280.
  `--window-size` alone does NOT emulate a phone.
  Save to `web/_screens/glass-*.png`.
- Look at every screenshot and fix:
  - anything unreadable
  - glass panels that look flat (no visible blur or sheen)
  - anything that scrolls sideways
- Append a summary to STATUS.md. Don't run git.
