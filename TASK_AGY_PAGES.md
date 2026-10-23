# Task: Separate Pilot page + site navigation (Antigravity). Own ONLY `web/site/`, `web/pilot/` (new), `web/index.html`.

The marketing site (`web/site/`) currently puts the pilot form inside the landing page, and its nav links are
in-page anchors. The user wants the website to send people to **separate subpages**:
- **Dashboard** (live tracking) → `../dashboard/`. That page already exists. Don't edit it, just link to it.
- **Pilot** → a new page `web/pilot/`.

## 1. `web/pilot/index.html` + `pilot.css` + `pilot.js`
- Move the pilot sign-up form out of `web/site/` into this page. It uses the same `submitPilot()` export from
  `../shared/api.js`, so keep the fields `{chapter, school, email, eventSize, note}`.
- Content, in plain words:
  - **Who it's for:** Greek chapters, student orgs and event hosts.
  - **What the free pilot includes:** 100 NFC wristbands, door setup on your phones, and the dashboard for one event.
  - **How it works:** 3 short steps. They're a real sequence, so numbering is fine.
  - The form, and a success state: "Request sent. We'll email you within 2 days."
- **Liquid Glass styling:** reuse `../shared/base.css` tokens and `.glass`. Use the Archivo condensed headline,
  like the site.
- Relative URLs only.

## 2. `web/site/`
- **Nav:** How it works (anchor), Privacy (anchor), **Dashboard** → `../dashboard/`, **Pilot** → `../pilot/`.
  - Primary button: "Request a pilot" → `../pilot/`.
  - Secondary: "Open door scanner" → `../door/`.
  - On phones, the nav collapses into a glass menu button with a sheet. No sideways scroll.
- Hero buttons:
  - "Request free pilot kit" → `../pilot/`
  - "See the live dashboard" → `../dashboard/` (replaces "Try the door scanner")
- **Remove** the pilot form section from the landing page. Put a short closing band at the bottom with one
  sentence and a button to `../pilot/`.
- Delete any now-dead JS in `site.js`.

## 3. `web/index.html` (the Pages root)
Make it redirect straight to `site/` (meta refresh plus a JS `location.replace`), with a visible fallback link.

## Verify
- `npm start` and open `localhost:4400/site/` and `/pilot/`.
- Submit the pilot form and confirm that `GET /api/pilot` with the header `X-Owner-Token` (env `HB_OWNER_TOKEN`)
  lists the submission, or that the `POST /api/pilot` 201 response comes back.
- Screenshot the site and pilot pages with Chrome DevTools Protocol mobile emulation at 390 × 844, and at 1280,
  into `web/_screens/pages-*.png`. Look at them and fix any problems.
- `npm test` passes.
- Append to STATUS.md. Don't run git.
