# Antigravity follow-up: ID scan at check-in (`web/` only)

Read the new "ID scanning" section in ARCHITECTURE.md and the `POST /api/id-checkin` endpoint in CONTRACT.md.
1. Vendor ZXing JS (Apache-2.0; a browser build that includes the PDF417 reader) into `web/shared/vendor/zxing/` with
   its license file. Use `BarcodeDetector({formats:['pdf417']})` when available, otherwise ZXing via `getUserMedia`
   (rear camera, `facingMode:'environment'`, torch toggle if supported).
2. `web/shared/aamva.js`: parse AAMVA PDF417 text into `{firstName, lastName, dob, idState, idExpires, licenseNumber}`.
   Handle field codes DAC/DCS/DCT (older versions), DBB/DBA dates in MMDDYYYY (US) and YYYYMMDD (Canada), and
   DAJ/DAQ. Add `web/shared/aamva.test.html` with 4 sample barcode strings (synthetic, not real people) showing parsed output.
3. Door IN flow: a big **Scan ID** button opens the camera with a guide box ("Back of license, barcode in the box").
   On decode → POST /api/id-checkin → result card: name, age, giant badge **21+** (green) / **UNDER 21** (red) /
   **EXPIRED** (amber), duplicate warning, guest-list match or candidates to choose from, then "Now tap their band" →
   links via /api/scan. Keep "No ID? Search guest list" as a fallback.
4. Never put the raw barcode text, address or license number in localStorage, logs or the UI.
Commit as you go; append to STATUS.md.
