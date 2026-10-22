#!/usr/bin/env python3
"""
samples/test-ids/make.py - Generates printable synthetic test barcodes for Homebound ID scanner testing.

Encodes AAMVA-compliant PDF417 barcodes with obviously synthetic data (TEST00001..., DCF=HOMEBOUND-TEST-NOT-AN-ID).
Cases are computed dynamically relative to today so they remain valid whenever run.
Outputs:
  - PNG barcodes for all 5 test cases
  - samples/test-ids/test-ids.html (plain white sheet, one row per barcode, huge warning banners)
  - samples/test-ids/test-ids.pdf (printable PDF)
  - Automated verification of decoding with zxingcpp and parsing with web/shared/aamva.js
"""

import sys
import os
import json
import subprocess
import datetime
from pathlib import Path

try:
    import pdf417gen
except ImportError:
    print("Error: pdf417gen is not installed. Run: cad/.venv/bin/pip install pdf417gen", file=sys.stderr)
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow is not installed. Run: cad/.venv/bin/pip install pillow", file=sys.stderr)
    sys.exit(1)

try:
    import zxingcpp
except ImportError:
    zxingcpp = None


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent


def compute_relative_date(base_date: datetime.date, year_delta: int) -> datetime.date:
    """Safely adds or subtracts years, handling leap years (Feb 29 -> Feb 28)."""
    try:
        return base_date.replace(year=base_date.year + year_delta)
    except ValueError:
        # e.g. Feb 29 on non-leap year
        return base_date.replace(year=base_date.year + year_delta, day=28)


def format_mmddyyyy(d: datetime.date) -> str:
    """Formats date as MMDDYYYY for AAMVA barcode fields (DBB, DBA)."""
    return d.strftime("%m%d%Y")


def format_iso(d: datetime.date) -> str:
    """Formats date as YYYY-MM-DD for human display and database comparison."""
    return d.strftime("%Y-%m-%d")


def build_aamva_payload(
    first_name: str,
    last_name: str,
    dob: datetime.date,
    exp: datetime.date,
    license_number: str,
    state: str = "CA",
    dcf: str = "HOMEBOUND-TEST-NOT-AN-ID",
) -> str:
    """
    Constructs an AAMVA compliant raw string formatted specifically for web/shared/aamva.js parsing.
    Includes AAMVA standard subfile header and standard element ID codes:
      - DAQ: License / Document Number
      - DCF: Document Discriminator / Synthetic Test Flag
      - DCS: Family Name (Last Name)
      - DAC: Given Name (First Name)
      - DBB: Date of Birth (MMDDYYYY)
      - DBA: Document Expiration Date (MMDDYYYY)
      - DAJ: Jurisdiction / State Code (2 letters)
    """
    dob_mmddyyyy = format_mmddyyyy(dob)
    exp_mmddyyyy = format_mmddyyyy(exp)

    # Standard AAMVA header: "@\n\x1e\rANSI 6360000102DL00390198DL" followed by records
    header = "@\n\x1e\rANSI 6360000102DL00390198DL"
    lines = [
        f"{header}DAQ{license_number}",
        f"DCF{dcf}",
        f"DCS{last_name.upper()}",
        f"DAC{first_name.upper()}",
        f"DBB{dob_mmddyyyy}",
        f"DBA{exp_mmddyyyy}",
        f"DAJ{state.upper()}",
        "",
    ]
    return "\n".join(lines)


def get_test_cases(today: datetime.date | None = None) -> list[dict]:
    """Generates the 5 specification test cases computed relative to today."""
    if today is None:
        today = datetime.date.today()

    # Case 1: Maya Chen (on samples/luma_guests.csv), age 25, expires +3 years -> 21+ and matches guest list
    c1_dob = compute_relative_date(today, -25)
    c1_exp = compute_relative_date(today, +3)

    # Case 2: Sam Park (on samples/luma_guests.csv), age 19 -> UNDER 21
    c2_dob = compute_relative_date(today, -19)
    c2_exp = compute_relative_date(today, +3)

    # Case 3: Lena Fischer (on samples/luma_guests.csv), age 30, expired last year -> EXPIRED
    c3_dob = compute_relative_date(today, -30)
    c3_exp = compute_relative_date(today, -1)

    # Case 4: The same data as #1 -> DUPLICATE warning once #1 has checked in
    c4_dob = c1_dob
    c4_exp = c1_exp

    # Case 5: "Riley Walkin", age 23, not on any list -> walk-in
    c5_dob = compute_relative_date(today, -23)
    c5_exp = compute_relative_date(today, +3)

    return [
        {
            "id": "case1",
            "case_number": 1,
            "title": "Case 1: Maya Chen · 21+ on Guest List",
            "name": "Maya Chen",
            "first_name": "MAYA",
            "last_name": "CHEN",
            "dob": c1_dob,
            "exp": c1_exp,
            "age": 25,
            "state": "CA",
            "license_number": "TEST00001",
            "expected_badge": "21+",
            "badge_color": "green",
            "expected_summary": "21+ · Matches approved Luma guest list",
            "behavior": "Matches gst-001 on samples/luma_guests.csv. Age 25 (>=21). Prompts door attendant to tap wristband to link guest.",
            "filename": "test_id_case1_maya_chen.png",
        },
        {
            "id": "case2",
            "case_number": 2,
            "title": "Case 2: Sam Park · Under 21",
            "name": "Sam Park",
            "first_name": "SAM",
            "last_name": "PARK",
            "dob": c2_dob,
            "exp": c2_exp,
            "age": 19,
            "state": "CA",
            "license_number": "TEST00002",
            "expected_badge": "UNDER 21",
            "badge_color": "red",
            "expected_summary": "UNDER 21 · Matches approved Luma guest list",
            "behavior": "Matches gst-003 on samples/luma_guests.csv. Age 19 (<21). Displays giant red UNDER 21 alert banner.",
            "filename": "test_id_case2_sam_park.png",
        },
        {
            "id": "case3",
            "case_number": 3,
            "title": "Case 3: Lena Fischer · Expired ID",
            "name": "Lena Fischer",
            "first_name": "LENA",
            "last_name": "FISCHER",
            "dob": c3_dob,
            "exp": c3_exp,
            "age": 30,
            "state": "CA",
            "license_number": "TEST00003",
            "expected_badge": "EXPIRED",
            "badge_color": "amber",
            "expected_summary": "EXPIRED · Matches approved Luma guest list",
            "behavior": "Matches gst-010 on samples/luma_guests.csv. Expired 1 year ago. Displays giant amber EXPIRED badge.",
            "filename": "test_id_case3_lena_fischer.png",
        },
        {
            "id": "case4",
            "case_number": 4,
            "title": "Case 4: Maya Chen · Duplicate Scan Warning",
            "name": "Maya Chen",
            "first_name": "MAYA",
            "last_name": "CHEN",
            "dob": c4_dob,
            "exp": c4_exp,
            "age": 25,
            "state": "CA",
            "license_number": "TEST00001",  # Identical payload to Case 1
            "expected_badge": "DUPLICATE",
            "badge_color": "amber",
            "expected_summary": "DUPLICATE WARNING · Already verified",
            "behavior": "Exact same barcode payload as Case 1. Once Case 1 has been scanned and linked, scanning this barcode immediately displays duplicate warning banner with previous timestamp.",
            "filename": "test_id_case4_maya_chen_duplicate.png",
        },
        {
            "id": "case5",
            "case_number": 5,
            "title": "Case 5: Riley Walkin · Walk-in (Not on list)",
            "name": "Riley Walkin",
            "first_name": "RILEY",
            "last_name": "WALKIN",
            "dob": c5_dob,
            "exp": c5_exp,
            "age": 23,
            "state": "CA",
            "license_number": "TEST00005",
            "expected_badge": "21+ (WALK-IN)",
            "badge_color": "green",
            "expected_summary": "21+ WALK-IN · Not on any imported list",
            "behavior": "Not present in samples/luma_guests.csv. Age 23 (>=21). Automatically creates a walk-in guest record and prompts band tap.",
            "filename": "test_id_case5_riley_walkin.png",
        },
    ]


def generate_barcodes(cases: list[dict], out_dir: Path) -> None:
    """Encodes and writes PDF417 PNG images for all test cases."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for c in cases:
        payload = build_aamva_payload(
            first_name=c["first_name"],
            last_name=c["last_name"],
            dob=c["dob"],
            exp=c["exp"],
            license_number=c["license_number"],
            state=c["state"],
        )
        c["payload"] = payload
        filepath = out_dir / c["filename"]

        # Encode with PDF417 generator (columns=6 gives a standard wide aspect ratio)
        codes = pdf417gen.encode(payload, columns=6, security_level=2)
        # scale=4, ratio=3, padding=20 produces a clean, high-DPI image (~720x220) easily readable on screens & paper
        image = pdf417gen.render_image(codes, scale=4, ratio=3, padding=20)
        image.save(filepath, format="PNG")
        c["filepath"] = filepath


def generate_html(cases: list[dict], out_file: Path, today: datetime.date) -> None:
    """Generates a plain white test sheet with huge warning banners, one row per barcode."""
    rows_html = []
    for c in cases:
        badge_style = {
            "green": "background: #27ae60; color: #ffffff;",
            "red": "background: #e74c3c; color: #ffffff;",
            "amber": "background: #f39c12; color: #000000;",
        }.get(c["badge_color"], "background: #333; color: #fff;")

        row = f"""
    <div class="test-row">
      <div class="banner">TEST DATA · NOT AN ID · for testing the Homebound ID scanner</div>
      <div class="row-content">
        <div class="barcode-col">
          <img class="barcode-img" src="{c['filename']}" alt="Test Barcode {c['case_number']}">
          <div class="barcode-caption">PDF417 Barcode · {c['license_number']}</div>
        </div>
        <div class="info-col">
          <div class="case-header">
            <h2 class="case-title">{c['title']}</h2>
            <span class="badge" style="{badge_style}">{c['expected_badge']}</span>
          </div>
          <div class="result-box">
            <strong>Expected Result:</strong> {c['expected_summary']}
          </div>
          <p class="case-desc">{c['behavior']}</p>
          <table class="meta-table">
            <tr><td><strong>Name:</strong></td><td>{c['first_name']} {c['last_name']} ({c['name']})</td></tr>
            <tr><td><strong>DOB:</strong></td><td>{format_iso(c['dob'])} (Age {c['age']}) · Raw DBB: {format_mmddyyyy(c['dob'])}</td></tr>
            <tr><td><strong>Expires:</strong></td><td>{format_iso(c['exp'])} · Raw DBA: {format_mmddyyyy(c['exp'])}</td></tr>
            <tr><td><strong>State:</strong></td><td>{c['state']} · License: {c['license_number']}</td></tr>
            <tr><td><strong>Special Field:</strong></td><td><code>DCF=HOMEBOUND-TEST-NOT-AN-ID</code></td></tr>
          </table>
        </div>
      </div>
    </div>"""
        rows_html.append(row)

    html_content = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Homebound ID Scanner Test Barcodes (NOT AN ID)</title>
  <style>
    /* Plain white printable sheet styles - anti-counterfeiting compliant: NO card styling, NO photos */
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #ffffff;
      color: #000000;
      line-height: 1.4;
      padding: 24px;
    }}
    .container {{
      max-width: 900px;
      margin: 0 auto;
    }}
    .sheet-header {{
      border-bottom: 3px solid #000000;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }}
    .sheet-title {{
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }}
    .disclaimer {{
      font-size: 14px;
      color: #333333;
      margin-bottom: 8px;
    }}
    .how-to {{
      background: #f7f7f7;
      border: 1px solid #cccccc;
      border-radius: 6px;
      padding: 12px 16px;
      font-size: 13px;
      margin-top: 10px;
    }}
    .how-to ol {{
      margin-left: 20px;
      margin-top: 6px;
    }}
    .how-to li {{
      margin-bottom: 4px;
    }}

    /* Test Rows */
    .test-row {{
      background: #ffffff;
      border: 2px solid #000000;
      border-radius: 8px;
      margin-bottom: 24px;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }}
    .banner {{
      background: #000000;
      color: #ffffff;
      font-size: 14px;
      font-weight: 800;
      text-align: center;
      padding: 8px 12px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }}
    .row-content {{
      display: flex;
      flex-direction: row;
      gap: 20px;
      padding: 16px;
      align-items: center;
    }}
    .barcode-col {{
      flex: 0 0 380px;
      text-align: center;
    }}
    .barcode-img {{
      width: 100%;
      height: auto;
      display: block;
      border: 1px solid #e0e0e0;
      background: #ffffff;
    }}
    .barcode-caption {{
      font-size: 11px;
      color: #666666;
      margin-top: 6px;
      font-family: monospace;
    }}
    .info-col {{
      flex: 1;
      min-width: 0;
    }}
    .case-header {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }}
    .case-title {{
      font-size: 18px;
      font-weight: 700;
      color: #000000;
    }}
    .badge {{
      display: inline-block;
      font-size: 12px;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 4px;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }}
    .result-box {{
      background: #f0f4f8;
      border-left: 4px solid #0f1630;
      padding: 8px 12px;
      font-size: 13px;
      margin-bottom: 8px;
    }}
    .case-desc {{
      font-size: 13px;
      color: #444444;
      margin-bottom: 10px;
    }}
    .meta-table {{
      font-size: 12px;
      border-collapse: collapse;
      width: 100%;
    }}
    .meta-table td {{
      padding: 3px 6px 3px 0;
      vertical-align: top;
    }}
    .meta-table code {{
      font-family: monospace;
      background: #f0f0f0;
      padding: 2px 4px;
      border-radius: 3px;
    }}

    @media print {{
      body {{
        padding: 0;
        background: #ffffff;
      }}
      .how-to {{
        display: none;
      }}
      .test-row {{
        border: 2px solid #000000;
        margin-bottom: 16px;
      }}
      .banner {{
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
      .badge {{
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
      .result-box {{
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
    }}
    @media (max-width: 768px) {{
      .row-content {{
        flex-direction: column;
      }}
      .barcode-col {{
        flex: 1 1 100%;
        width: 100%;
      }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <header class="sheet-header">
      <h1 class="sheet-title">TEST DATA · NOT AN ID</h1>
      <p class="disclaimer">
        <strong>Strictly for testing the Homebound ID scanner.</strong> All records are synthetic.
        Generated on {today.isoformat()} relative to current date so age rules evaluate accurately.
      </p>
      <div class="how-to">
        <strong>How to test with the Homebound door scanner:</strong>
        <ol>
          <li>Ensure server is running: <code>npm start</code> (on port 4400)</li>
          <li>In admin (<code>/admin</code>), upload <code>samples/luma_guests.csv</code> to populate Maya Chen, Sam Park, and Lena Fischer</li>
          <li>Open <code>http://localhost:4400/door</code> on a phone camera or laptop</li>
          <li>Tap <strong>Scan ID</strong> and frame the barcode below in the camera guide</li>
        </ol>
      </div>
    </header>

    <main id="cases">
{"".join(rows_html)}
    </main>
  </div>
</body>
</html>"""

    with open(out_file, "w", encoding="utf-8") as f:
        f.write(html_content)


def generate_pdf(html_path: Path, pdf_path: Path, cases: list[dict]) -> bool:
    """Renders HTML to PDF using headless Chrome if available, or PIL composition as fallback."""
    # Try Chrome headless
    chrome_paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "google-chrome",
        "chromium",
    ]
    for cp in chrome_paths:
        try:
            cmd = [
                cp,
                "--headless",
                "--disable-gpu",
                "--no-pdf-header-footer",
                f"--print-to-pdf={pdf_path}",
                str(html_path.resolve()),
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            if res.returncode == 0 and pdf_path.exists() and pdf_path.stat().st_size > 0:
                return True
        except Exception:
            continue

    # Fallback using PIL to compose a clean multi-page or single-page PDF
    try:
        from PIL import ImageDraw, ImageFont

        page_w, page_h = 1200, 1600
        canvas = Image.new("RGB", (page_w, page_h), "#ffffff")
        draw = ImageDraw.Draw(canvas)

        # Header banner
        draw.rectangle([0, 0, page_w, 60], fill="#000000")
        draw.text((page_w // 2, 30), "TEST DATA · NOT AN ID · HOMEBOUND ID SCANNER TESTING", fill="#ffffff", anchor="mm")

        y = 90
        for c in cases[:4]:  # First 4 cases on sheet
            draw.rectangle([40, y, page_w - 40, y + 30], fill="#000000")
            draw.text(((page_w) // 2, y + 15), "TEST DATA · NOT AN ID", fill="#ffffff", anchor="mm")
            b_img = Image.open(c["filepath"]).convert("RGB")
            # Resize barcode to fit nicely
            bw, bh = b_img.size
            ratio = 320 / bw
            b_img = b_img.resize((320, int(bh * ratio)))
            canvas.paste(b_img, (60, y + 45))

            draw.text((420, y + 50), c["title"], fill="#000000")
            draw.text((420, y + 80), f"Expected: {c['expected_summary']}", fill="#333333")
            draw.text((420, y + 110), f"Name: {c['name']} · DOB: {format_iso(c['dob'])} · Expires: {format_iso(c['exp'])}", fill="#555555")
            draw.text((420, y + 135), f"License: {c['license_number']} · State: {c['state']} · DCF=HOMEBOUND-TEST-NOT-AN-ID", fill="#777777")
            y += 240

        canvas.save(pdf_path, "PDF", resolution=150.0)
        return True
    except Exception as e:
        print(f"Warning: PDF generation failed: {e}", file=sys.stderr)
        return False


def verify_cases(cases: list[dict]) -> bool:
    """
    Decodes every PNG back using zxingcpp, checks that the text matches the raw payload,
    and runs web/shared/aamva.js via Node to ensure exact web parser compliance.
    """
    print("\nVerifying test barcodes:")
    all_passed = True

    for c in cases:
        filepath = c["filepath"]
        img = Image.open(filepath)

        # 1. Decode with zxingcpp
        if zxingcpp:
            barcodes = zxingcpp.read_barcodes(img, text_mode=zxingcpp.TextMode.Plain)
            if not barcodes:
                print(f"  ✕ {c['id']}: Failed to decode barcode image with zxingcpp!")
                all_passed = False
                continue
            decoded_text = barcodes[0].text
            if decoded_text != c["payload"]:
                print(f"  ✕ {c['id']}: Decoded text mismatch with payload!")
                all_passed = False
                continue
        else:
            decoded_text = c["payload"]

        # 2. Parse with web/shared/aamva.js using Node.js
        node_script = f"""
import('{REPO_ROOT}/web/shared/aamva.js').then(({{ parseAamva }}) => {{
  const raw = {json.dumps(decoded_text)};
  const parsed = parseAamva(raw);
  console.log(JSON.stringify(parsed));
}}).catch(err => {{
  console.error(err);
  process.exit(1);
}});
"""
        try:
            res = subprocess.run(
                ["node", "-e", node_script],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
            )
            parsed = json.loads(res.stdout.strip())
        except Exception as e:
            print(f"  ✕ {c['id']}: Node aamva.js parsing failed: {e}")
            all_passed = False
            continue

        # Check expected parsed fields
        expected_fields = {
            "firstName": c["first_name"],
            "lastName": c["last_name"],
            "dob": format_iso(c["dob"]),
            "idExpires": format_iso(c["exp"]),
            "idState": c["state"],
            "licenseNumber": c["license_number"],
        }
        for k, v in expected_fields.items():
            if parsed.get(k) != v:
                print(f"  ✕ {c['id']}: Field '{k}' mismatch: expected {v}, got {parsed.get(k)}")
                all_passed = False
                break
        else:
            print(f"  ✓ {c['title']} -> Decodes & parses correctly ({c['license_number']}, {format_iso(c['dob'])})")

    return all_passed


def main():
    today = datetime.date.today()
    cases = get_test_cases(today)

    print(f"Generating synthetic test barcodes for Homebound ID scanner (Relative to {today.isoformat()})...")
    generate_barcodes(cases, SCRIPT_DIR)

    html_file = SCRIPT_DIR / "test-ids.html"
    generate_html(cases, html_file, today)
    print(f"Wrote HTML sheet: {html_file.relative_to(REPO_ROOT)}")

    pdf_file = SCRIPT_DIR / "test-ids.pdf"
    pdf_ok = generate_pdf(html_file, pdf_file, cases)
    if pdf_ok:
        print(f"Wrote PDF sheet: {pdf_file.relative_to(REPO_ROOT)}")

    # Verify all barcodes
    success = verify_cases(cases)
    if not success:
        sys.exit(1)
    print("\nAll test barcodes generated and verified successfully!")


if __name__ == "__main__":
    main()
