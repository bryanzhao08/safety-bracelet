# Homebound on Google Sheets & GitHub Pages

Homebound can run completely serverless with **zero infrastructure**. The frontend is hosted statically on GitHub Pages, and a private Google Sheet acts as the event database. Every check-in, scan, and departure is recorded live as a row in the organizer's spreadsheet.

---

## 1. 5-Step Setup

1. **Create a Google Sheet**
   - Open [Google Sheets](https://sheets.new) and create a new blank spreadsheet. Name it after your event (e.g., `Homebound - Spring Formal 2026`).

2. **Open Apps Script & Paste the Code**
   - In the spreadsheet menu, go to **Extensions → Apps Script**.
   - Select all code in `Code.gs` and replace it with the contents of [`sheets/Code.gs`](sheets/Code.gs) (you can also use the **Copy Apps Script Code** button on the `/setup/` page).
   - Press **Save** (`Cmd+S` / `Ctrl+S`).

3. **Run `setup`**
   - In the function dropdown at the top toolbar, select `setup` and click **Run**.
   - Review and grant the necessary Google Workspace permissions when prompted.
   - An alert dialog will appear displaying:
     - **Admin PIN** (8 digits)
     - **Monitor Code** (6 characters)
   - The script automatically generates all required tabs (`Guests`, `Bands`, `Scans`, `Departures`, `Audit`, `Settings`) with bold headers and frozen rows.

4. **Deploy as a Web App**
   - In the top right of Apps Script, click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Set the configuration:
     - **Description**: `Homebound Backend`
     - **Execute as**: `Me (<your-email>)`
     - **Who has access**: `Anyone` *(Note: this allows the static frontend to communicate with your Apps Script; requests still require the secret PIN or monitor token)*.
   - Click **Deploy** and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).

5. **Connect on Homebound Setup**
   - Open `https://bryanzhao08.github.io/safety-bracelet/setup/` (or your local setup page).
   - Paste the Web app URL and click **Connect & Test Connection**.
   - Enter your 8-digit Admin PIN to verify and unlock event controls.
   - Share the generated **Monitor Door Link** or QR code with door staff.

---

## 2. Privacy & Security Architecture

Homebound follows strict privacy invariants:

- **Organizer Ownership**: The Google Sheet is stored entirely in your Google Drive. Never share the spreadsheet with guests or door staff. Only you (the spreadsheet owner) have access to the raw sheet.
- **Access Control**: Anyone with the Web app URL still requires the **Admin PIN** (8 digits) for organizer actions or a valid **Monitor Code** (6 characters) to initiate a monitor session.
- **Invariants at the Door**: Monitor surfaces and responses never receive or return guest email, phone numbers, or driver's license numbers.
- **ID Check-in Privacy**: When an ID barcode is scanned at the door, the license number is used strictly on-the-fly to compute a cryptographic HMAC-SHA256 hash (`idHash`) with your event's unique 32-byte secret. The raw license number and address are **never stored** in the sheet and **never transmitted** in responses.
- **Group Departures**: Departure groups link leaving attendees together by `groupId` without ever exposing personal circles or destination data.
- **Retention**: Run **Homebound → Install retention trigger** from the spreadsheet menu to install a daily automated purge trigger. All personal rows (`Guests`, `Bands`, `Scans`, `Departures`) are deleted `retentionDays` (default: 30) after the event ends.

---

## 3. Quotas, Latency & Practical Limits

Google Apps Script runs in a serverless cloud environment managed by Google:

- **Response Latency**: Calls to Apps Script web apps generally take between **1.0 to 2.5 seconds** due to Google's execution environment. For parties with several hundred attendees, this is fast enough for smooth door entry and checkout.
- **Concurrency & Locks**: Write operations use `LockService.getScriptLock()` with a 30-second timeout to prevent race conditions when multiple monitors scan concurrently.
- **Quotas**: Free Google accounts have a limit of 20,000 URL fetch / trigger executions per day and 90 minutes of script runtime per day; Google Workspace accounts have significantly higher limits (100,000+ calls/day). This easily accommodates private events and chapter parties.
- **High-throughput events**: For large-scale events (> 1,000 guests) requiring sub-50ms scan latency, use the native Node server (`npm start`).

## Pilot sign-ups on the public site

On GitHub Pages there's no server, so the Pilot page sends sign-ups to a Google Sheet of yours:

1. Make a new Google Sheet called "Homebound pilots", open Extensions → Apps Script, paste `sheets/Code.gs`,
   and deploy it as a web app (Execute as: Me, Who has access: Anyone). You don't need to run `setup`.
2. Put the `/exec` URL in `PILOT_SHEET_URL` in `web/shared/config.js` and push.

Each sign-up becomes a row in the `Pilot` tab. Until the URL is set, the form says sign-ups aren't connected yet.
