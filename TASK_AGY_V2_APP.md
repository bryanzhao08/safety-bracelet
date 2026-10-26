# Task: App v2 UI: dark blue Liquid Glass, socials, host + user settings (Antigravity, agent B)

Read `DESIGN.md` (the visual spec; follow it exactly) and the "v2 changes" section of `APP_CONTRACT.md`.

Own ONLY `web/app/` **except** these, which belong to others:
- `web/app/lib/` (Codex is changing the API now; import the names exactly as the contract lists them)
- `web/app/icon*` and `web/app/manifest.webmanifest` (agent C)

1. **Restyle the whole app to DESIGN.md:**
   - tokens, background glows, the glass recipe and its opaque fallback
   - the floating capsule tab bar
   - the glass pass with the white QR window and the tilt rim light
   - the flip confirmation
   - no all-caps labels; remove "YOUR TICKET" and the uppercase chip
2. **Scanning:**
   - "Scan theirs" (back camera) and "Face to face" (front camera plus your QR) both work.
   - `parseScan` now returns `{kind:'card'|'party'}`; route it accordingly.
   - Show a clear error for any other QR.
   - Add a manual fallback, "Paste a code or link", for when the camera is blocked.
3. **Socials:**
   - **Onboarding and You settings:** each platform from `PLATFORMS` gets three ways to fill in the handle:
     - **Connect:** opens the platform and shows its `shareHelp` steps, then "Paste link" via the clipboard
       through `parseProfileLink`, with a preview capsule to confirm.
     - **Paste link.**
     - **Type it.**
   - **Share toggles:** a toggle per field, "Share in my code".
   - **Where they show:** People rows and the confirmation show social capsules using `profileUrl`.
   - **Contact actions:** "Save contact" (vCard), plus Call and Text.
4. **Passcode:**
   - Onboarding and "change passcode" require 6–8 digits.
   - The keypad shows 6 dots, growing to 8 if typed.
   - After a legacy unlock (`isLegacyPasscode`), force "Choose a new 6-digit passcode".
5. **Settings:** the gear opens a sheet with two entries, **You** and **Host a party**, built per the contract.
   - Joined party: a banner with the `data-party-banner` attribute, "Help" and "Ride".
   - The dawn "Home safe? Tap I'm home" reminder.
   - A print stylesheet for the party QR.
6. **Night:**
   - The recap card is the only dawn-tinted surface, and mentions parties.
   - "Arrived at …" rows in lilac.
7. **Service worker:** bump the cache to `hb-app-v2`.

## Verify
- Serve `web/` statically.
- Use Chrome DevTools Protocol mobile emulation (390 × 844, mobile:true, dpr 3; `--window-size` is NOT enough).
  Screenshot to `web/_screens/v2-*.png`:
  - onboarding socials
  - Swap with the party banner
  - the scan confirmation with socials
  - People
  - the passcode keypad
  - Night unlocked
  - You settings
  - Host a party, plus the party QR
- Check every screenshot against DESIGN.md: contrast, no caps labels, glass only on controls. Fix, then
  re-shoot.
- `npm test` and `npm run smoke:app` pass.
- Append to STATUS.md. Don't run git.
