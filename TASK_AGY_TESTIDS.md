# Antigravity: printable TEST barcodes for checking the Homebound ID scanner (own ONLY samples/test-ids/)

Purpose: let the team test the door's "Scan ID" step without using anyone's real license. This must NOT look like an ID card.
1. Python script `samples/test-ids/make.py` (use `cad/.venv/bin/python`; `pip install pdf417gen` into that venv) that
   encodes AAMVA-format text (the same layout web/shared/aamva.js parses: DAQ, DCS, DAC, DBB, DBA, DAJ in MMDDYYYY) into
   PDF417 PNGs. Contents are synthetic and obviously fake:
   - license numbers `TEST00001`… (DAQ), and add field `DCF` = `HOMEBOUND-TEST-NOT-AN-ID`
   - cases, computed relative to today so they stay valid:
     1. Maya Chen (on samples/luma_guests.csv), age 25, expires +3 years → 21+ and matches the guest list
     2. Sam Park, age 19 → UNDER 21
     3. Lena Fischer, age 30, expired last year → EXPIRED
     4. the same data as #1 → DUPLICATE warning once #1 has checked in
     5. "Riley Walkin", age 23, not on any list → walk-in
2. `samples/test-ids/test-ids.html` (and `test-ids.pdf` if easy): a plain white sheet, one barcode per row. Each row has a
   huge banner **"TEST DATA · NOT AN ID · for testing the Homebound ID scanner"**, the case name and the expected result.
   No card shapes, no photos, no state seals or artwork, nothing styled like a license.
3. `samples/test-ids/README.md`: how to use it (print it or show it on a second screen, open /door, Scan ID) and why it exists.
Verify every PNG decodes back with zxing (python `zxing-cpp` or the vendored web decoder) and parses to the expected fields
with web/shared/aamva.js logic. Append one line to STATUS.md.
