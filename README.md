# Homebound

Homebound is an installable phone web app for swapping contact details at a party. Show your QR card or scan someone else's. The next morning, your private night log helps you remember who you met and when.

## Two layers

**People** is a public contact list on your phone. It contains the names and contact details you exchanged, sorted by name. It has no meeting times or locations.

**Night log** is a private timeline of meetings, notes, and “I'm home” entries. Each entry is encrypted before it is saved on the device. You can add entries while the log is locked; reading them requires your passcode. If you enable location in Settings, entries may include a coarse location. Location is off by default.

There is no app server or account. The app and site are static files, and the log stays on the phone unless you choose to share or export it. A shared contact card travels in the URL fragment after `#`, which the hosting server does not receive.

## Privacy limits

The locked log protects against someone casually holding your unlocked phone and browsing the app. The static hosting server does not receive the contact card in a QR URL's fragment or the on-device log.

It does **not** protect against malware on the phone, someone watching you enter your passcode, or an attacker brute-forcing a copied storage dump. A four-digit passcode is especially vulnerable to that last attack even with the app's key derivation. Choose **six or more digits**. If you forget the passcode, the log cannot be recovered; “Delete everything” is the only reset.

## Add to Home Screen

- **iPhone:** Open the app in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** Open the app in Chrome, open the **⋮** menu, then choose **Install app** or **Add to Home screen**.

## Development

Requires Node 24 and Chrome for the browser smoke test. Serve `web/` as static files to try the app locally, for example:

```sh
python3 -m http.server 4600 -d web
```

Open `http://localhost:4600/app/`. To verify:

```sh
npm test
npm run smoke:app
```

`npm test` runs the app library and security tests alongside the older server tests. `npm run smoke:app` launches headless Chrome and checks onboarding, scans, storage privacy, mobile layout, network origins, and console errors.

**Legacy:** the wristband version lives in `server/`, `sheets/`, `cad/`, `pcb/` and is no longer linked.
