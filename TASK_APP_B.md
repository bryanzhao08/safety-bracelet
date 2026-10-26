# Task: Homebound app UI + PWA + landing site (Antigravity, agent B)

Read `APP_CONTRACT.md` first. It is the spec. Own ONLY:
- `web/app/` (except `web/app/lib/`)
- `web/site/`
- `web/index.html`

Agent A is building `web/app/lib/` (card, vault, store, nights) at the same time. Import exactly the names in the
contract. If a module isn't there yet, write against the contract and check STATUS.md later.

## Product, in one line
Swap contacts at a party by scanning QR codes. Your phone quietly keeps a private, passcode-locked timeline of who
you met and when, so the morning after you know who you were with.

## Design
Keep the Homebound look, using `../shared/base.css` tokens:
- **Palette:** night `#1B2340` background; band-orange `#FF7A1A`, band-pink `#FF4FA3`, band-lime `#C6F432`.
- **Type:** Archivo condensed for big text, Atkinson Hyperlegible Next for body.
- **Liquid Glass surfaces.**

**The memorable element:** your contact card on the Swap screen.
- A ticket stub: white card, perforated tab edge, your name in big Archivo, and the QR filling the card.
- Below it, two buttons: "Scan theirs" (solid orange) and "Face to face" (glass).
- In "Face to face", the screen splits: your QR on top, front-camera viewfinder below, with the line "Hold your
  phones screen to screen".
- After a scan: a full-screen pink confirmation, "Added Jordan" (or "Still with Jordan"), with Call / Text /
  Instagram buttons, then auto-return.

**Night tab:**
- Big passcode keypad. Use real `<button>`s, `inputmode` numeric. Show "Wrong passcode" on failure; no lockout.
- Once unlocked: recap card on top, then a timeline. Big times in Archivo on the left, a colored dot (pink met,
  orange note, lime home) and the name or text on the right. A small map link when there's a location: an
  `https://maps.apple.com/?ll=lat,lng` link, opened by the user only.

**Swap "…" menu:** "Add a note" and "I'm home". Both work without the passcode and confirm "Saved to your night".

**Copy:** plain, sentence case, no "blackout" in the UI. Use "the morning after", "who you were with".

**Accessibility:** big touch targets (≥ 48 px), visible focus, `prefers-reduced-motion` respected, and no sideways
scroll at 360–430 px wide.

## Landing site `web/site/`
- **Rewrite for the new product.**
  - Hero: "Swap numbers. Remember the night." with a short line under it, and a primary button "Open the app" →
    `../app/`.
  - Three short sections:
    - how swapping works
    - the private night log (encrypted on your phone, only your passcode opens it)
    - "Add to Home Screen" instructions for iPhone and Android
- **Remove all wristband, door, dashboard, pilot and Ticketbud-style content and links.**
- `web/index.html` keeps redirecting to `site/`.

## Verify
- **Serve `web/` statically**, e.g. `npx http-server web -p 4600`, or `python3 -m http.server 4600 -d web`.
- **Mobile screenshots:** use Chrome DevTools Protocol with `Emulation.setDeviceMetricsOverride` (390 × 844,
  mobile:true, dpr 3). `--window-size` is NOT enough. Screenshot to `web/_screens/app-*.png`:
  - onboarding
  - Swap
  - the scan confirmation: simulate a scan by loading `app/#add=<encodeCard(...)>` for two different people, then
    one again after faking +15 min if needed
  - People
  - Night locked
  - Night unlocked with entries
  - the site hero
- Look at each screenshot and fix what's off. Check the log in localStorage is ciphertext only.
- `npm test` passes.
- Append to STATUS.md. Don't run git.
