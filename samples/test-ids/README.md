# Synthetic Test Barcodes for Homebound ID Scanner

These printable PDF417 barcodes allow event organizers, door attendants, and developers to test the Homebound door scanner's **"Scan ID"** step safely without scanning anyone's real driver license.

> **CRITICAL COMPLIANCE NOTICE**:
> These test barcodes are **NOT ID CARDS**.
> To prevent any counterfeiting confusion, they are formatted as a plain white technical test sheet.
> They contain **NO card shapes, NO photos, NO state seals, NO signatures, and NO license styling**.
> Every row is explicitly marked with:
> **`TEST DATA · NOT AN ID · for testing the Homebound ID scanner`**
> Every barcode record embeds `DCF=HOMEBOUND-TEST-NOT-AN-ID` and synthetic license numbers (`TEST00001`…).

---

## Why This Exists

1. **Privacy & Safety**: Real driver licenses contain unredacted legal names, home addresses, license numbers, and exact birthdates. Testing door hardware and software with real IDs risks accidental leakage or unauthorized handling.
2. **Deterministic Verification**: Testing edge cases (e.g. Under-21 warnings, expired documents, duplicate scans, and unregistered walk-ins) requires specific dates and names matching or not matching the event guest list.
3. **Dynamic Validity**: Dates in this suite are computed dynamically relative to `today` when generated so they never become stale or accidentally flip age categories over time.

---

## Test Cases & Expected Outcomes

| Case # | Target / Scenario | Name | Age | Expiration | Expected Door Outcome |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **1** | Approved 21+ Guest | Maya Chen | 25 | +3 years | **21+** (Green badge) · Matches `gst-001` on `samples/luma_guests.csv`. Prompts wristband tap to link. |
| **2** | Under-21 Guest | Sam Park | 19 | +3 years | **UNDER 21** (Red badge) · Matches `gst-003` on `samples/luma_guests.csv`. Highlights minor status. |
| **3** | Expired ID | Lena Fischer | 30 | -1 year | **EXPIRED** (Amber badge) · Matches `gst-010` on `samples/luma_guests.csv`. ID expired last year. |
| **4** | Duplicate Scan | Maya Chen | 25 | +3 years | **DUPLICATE WARNING** (Amber banner) · Identical payload to #1. Triggers duplicate warning once #1 has checked in. |
| **5** | Walk-in Guest | Riley Walkin | 23 | +3 years | **21+ (WALK-IN)** (Green badge) · Not on imported guest list. Automatically registers walk-in record & prompts band link. |

---

## How to Use

### Option A: Display on a Second Screen (Laptop, Monitor, or Tablet)
1. Open [`samples/test-ids/test-ids.html`](test-ids.html) in any web browser on your computer or tablet.
2. Ensure the Homebound server is running:
   ```bash
   npm start
   ```
   *(Running locally on `http://localhost:4400`)*
3. On an admin tab (`http://localhost:4400/admin`), upload the sample guest list [`samples/luma_guests.csv`](../luma_guests.csv).
4. On your test phone (or a separate browser window with webcam access), navigate to:
   ```
   http://localhost:4400/door
   ```
5. Ensure the mode is set to **IN**, tap **Scan ID**, and point the camera at the desired test barcode on screen.

### Option B: Print on Paper
1. Open [`samples/test-ids/test-ids.pdf`](test-ids.pdf) or press `Cmd+P` / `Ctrl+P` in `test-ids.html`.
2. Print on standard Letter or A4 paper.
3. Use the printed sheet at the door station to test physical scanning with phone cameras or barcode scanners.

---

## How It Works (AAMVA Structure)

The generator creates standard AAMVA PDF417 subfile records that match the parser in [`web/shared/aamva.js`](../../web/shared/aamva.js) and the server verification in [`server/id-checkin.js`](../../server/id-checkin.js):

- Subfile Header: `@\n\x1e\rANSI 6360000102DL00390198DL`
- `DAQ`: Synthetic license number (`TEST00001`...)
- `DCF`: `HOMEBOUND-TEST-NOT-AN-ID`
- `DCS`: Last name (e.g. `CHEN`, `PARK`, `FISCHER`, `WALKIN`)
- `DAC`: First name (e.g. `MAYA`, `SAM`, `LENA`, `RILEY`)
- `DBB`: Date of birth formatted as `MMDDYYYY`
- `DBA`: Expiration date formatted as `MMDDYYYY`
- `DAJ`: Jurisdiction / State (`CA`)

Neither the door UI nor the Homebound server stores raw license numbers or full AAMVA payloads in the database. Instead, an event-scoped HMAC-SHA256 hash (`idHash`) is computed and stored to detect duplicate entries, while names and verified age statuses (`over21`) are retained.

---

## Regenerating Barcodes

To regenerate the barcode PNGs, HTML sheet, and PDF relative to today's date:

```bash
cad/.venv/bin/python samples/test-ids/make.py
```

The script automatically:
1. Re-encodes the 5 test barcodes via `pdf417gen`.
2. Updates `test-ids.html` and compiles `test-ids.pdf`.
3. Verifies every image with `zxingcpp` and validates parsing against `web/shared/aamva.js`.
