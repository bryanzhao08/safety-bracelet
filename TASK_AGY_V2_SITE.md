# Task: Landing site + app icon in the v2 design (Antigravity, agent C)

Read `DESIGN.md` and `APP_CONTRACT.md` (v2 section). Own ONLY:
- `web/site/`
- `web/app/icon*`
- `web/app/manifest.webmanifest`

1. **Restyle `web/site/` to DESIGN.md:**
   - the same tokens, glows and glass
   - no all-caps eyebrows and no `→`
   - keep "Swap numbers. Remember the night." as the hero
   - the hero visual is a live, tilting glass pass mock using the same pass styling (no fake app screenshots)
2. **Sections:** short, plain copy. They aren't a sequence, so don't number them.
   - **Swap in a second:** scan, or hold phones face to face. Instagram, Snapchat, TikTok, X and LinkedIn go
     straight to their apps.
   - **Your private night:** encrypted on your phone; only your 6-digit passcode opens it; nobody else, not even
     a party host, can see it.
   - **For hosts:** make a party code with your help number and ride info; guests get a "Home safe?" reminder
     when it ends; you never see their contacts.
   - **Add to Home Screen:** iPhone and Android steps.
3. **Icon:**
   - A new `icon.svg`: a simple glass pass with a QR corner on `--midnight`.
   - PNG 192/512 plus a maskable 512, rendered from the SVG with headless Chrome or `sips`.
   - Update the manifest `theme_color` / `background_color` to `#0A1636`.
4. **Verify:**
   - Use Chrome DevTools Protocol mobile screenshots (390 × 844) plus a 1280 one into `web/_screens/v2-site-*.png`.
     Review and fix.
   - No horizontal scroll at 360.
   - Append to STATUS.md. Don't run git.
