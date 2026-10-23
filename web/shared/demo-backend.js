// web/shared/demo-backend.js - In-browser fake Google Apps Script execution for demo mode

const DEMO_STORAGE_KEY = 'hb_demo';
const DEMO_SHEET_KEY = 'hb_demo_sheet';
const DEMO_CACHE_KEY = 'hb_demo_cache';

export const DEMO_EVENT_ID = 'demo_event';
export const DEMO_ADMIN_PIN = '00000000';
export const DEMO_MONITOR_CODE = 'DEMO42';
export const DEMO_MONITOR_TOKEN = 'mon_demo_token_you';

export class ApiError extends Error {
  constructor(status, error, message) {
    super(message || error || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
  }
}

function saveAdminSession({ eventId, adminPin, monitorCode }) {
  if (typeof localStorage === 'undefined') return;
  if (eventId) localStorage.setItem('hb_admin_event_id', eventId);
  if (adminPin) localStorage.setItem('hb_admin_pin', adminPin);
  if (monitorCode) localStorage.setItem('hb_admin_monitor_code', monitorCode);
}

function saveMonitorSession({ token, eventId, eventName, name }) {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem('hb_monitor_token', token);
  if (eventId) localStorage.setItem('hb_monitor_event_id', eventId);
  if (eventName) localStorage.setItem('hb_monitor_event_name', eventName);
  if (name) localStorage.setItem('hb_monitor_name', name);
}

function clearAdminSession() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem('hb_admin_pin');
  localStorage.removeItem('hb_admin_event_id');
  localStorage.removeItem('hb_admin_monitor_code');
}

function clearMonitorSession() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem('hb_monitor_token');
  localStorage.removeItem('hb_monitor_event_id');
  localStorage.removeItem('hb_monitor_event_name');
  localStorage.removeItem('hb_monitor_name');
}

// --- Pure JS SHA-256 and HMAC-SHA256 ---

function sha256Bytes(data) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const l = bytes.length;
  const bitLen = l * 8;
  const padLen = (l % 64 < 56) ? (56 - (l % 64)) : (120 - (l % 64));
  const totalLen = l + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[l] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000));

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < totalLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (((w[t - 16] + s0) | 0) + ((w[t - 7] + s1) | 0)) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = ((((((h + S1) | 0) + ch) | 0) + K[t]) | 0) + w[t] | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0);
  outView.setUint32(4, h1);
  outView.setUint32(8, h2);
  outView.setUint32(12, h3);
  outView.setUint32(16, h4);
  outView.setUint32(20, h5);
  outView.setUint32(24, h6);
  outView.setUint32(28, h7);
  return out;
}

function hmacSha256(value, key) {
  const enc = new TextEncoder();
  let kBytes = typeof key === 'string' ? enc.encode(key) : key;
  const vBytes = typeof value === 'string' ? enc.encode(value) : value;
  if (kBytes.length > 64) {
    kBytes = sha256Bytes(kBytes);
  }
  const kPadded = new Uint8Array(64);
  kPadded.set(kBytes);

  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = kPadded[i] ^ 0x36;
    opad[i] = kPadded[i] ^ 0x5c;
  }

  const inner = new Uint8Array(64 + vBytes.length);
  inner.set(ipad, 0);
  inner.set(vBytes, 64);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(64 + 32);
  outer.set(opad, 0);
  outer.set(innerHash, 64);
  const outerHash = sha256Bytes(outer);

  // Return signed 8-bit integers matching Apps Script Utilities.computeHmacSha256Signature
  return Array.from(outerHash).map(b => (b > 127 ? b - 256 : b));
}

// --- In-Browser Fakes ---

class FakeSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows.map(r => [...r]);
    this._onChanged = null;
  }

  _notify() {
    if (this._onChanged) this._onChanged();
  }

  appendRow(row) {
    this.rows.push([...row]);
    this._notify();
  }

  getDataRange() {
    return {
      getValues: () => this.rows.map(r => [...r]),
    };
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return {
      setValue: (val) => {
        if (!this.rows[row - 1]) this.rows[row - 1] = [];
        this.rows[row - 1][col - 1] = val;
        this._notify();
      },
      setFontWeight: () => {},
      getValues: () => {
        const res = [];
        for (let r = 0; r < numRows; r++) {
          const rowArr = [];
          for (let c = 0; c < numCols; c++) {
            rowArr.push(this.rows[row - 1 + r]?.[col - 1 + c] ?? '');
          }
          res.push(rowArr);
        }
        return res;
      },
    };
  }

  deleteRows(startRow, count) {
    this.rows.splice(startRow - 1, count);
    this._notify();
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows[0] ? this.rows[0].length : 0;
  }

  setFrozenRows() {}
}

function loadSheetsData() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DEMO_SHEET_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSheetsData(sheetsMap) {
  if (typeof localStorage === 'undefined') return;
  try {
    const data = {};
    for (const [name, sheet] of sheetsMap.entries()) {
      data[name] = sheet.rows;
    }
    localStorage.setItem(DEMO_SHEET_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed to save demo sheet to localStorage', err);
  }
}

function loadCacheData() {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(DEMO_CACHE_KEY);
    return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
  } catch {
    return new Map();
  }
}

function saveCacheData(cacheMap) {
  if (typeof localStorage === 'undefined') return;
  try {
    const obj = Object.fromEntries(cacheMap.entries());
    localStorage.setItem(DEMO_CACHE_KEY, JSON.stringify(obj));
  } catch (_) {}
}

function createBrowserFakes() {
  const savedSheets = loadSheetsData();
  const sheetsMap = new Map();

  const persist = () => saveSheetsData(sheetsMap);

  if (savedSheets) {
    for (const [name, rows] of Object.entries(savedSheets)) {
      const sheet = new FakeSheet(name, rows);
      sheet._onChanged = persist;
      sheetsMap.set(name, sheet);
    }
  }

  const fakeSpreadsheet = {
    getSheetByName(name) {
      return sheetsMap.get(name) || null;
    },
    insertSheet(name) {
      const sheet = new FakeSheet(name);
      sheet._onChanged = persist;
      sheetsMap.set(name, sheet);
      persist();
      return sheet;
    },
    deleteSheet(sheet) {
      sheetsMap.delete(sheet.name);
      persist();
    },
    getSheets() {
      return Array.from(sheetsMap.values());
    },
  };

  const fakeCache = loadCacheData();

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => fakeSpreadsheet,
    getUi: () => ({
      alert: () => {},
      createMenu: () => ({
        addItem: () => ({
          addItem: () => ({
            addToUi: () => {},
          }),
        }),
      }),
    }),
  };

  const Utilities = {
    computeHmacSha256Signature(value, key) {
      return hmacSha256(value, key);
    },
  };

  const LockService = {
    getScriptLock: () => ({
      waitLock: () => {},
      tryLock: () => true,
      releaseLock: () => {},
    }),
  };

  const CacheService = {
    getScriptCache: () => ({
      get: (key) => fakeCache.get(key) || null,
      put: (key, val) => {
        fakeCache.set(key, String(val));
        saveCacheData(fakeCache);
      },
      remove: (key) => {
        fakeCache.delete(key);
        saveCacheData(fakeCache);
      },
    }),
  };

  const ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput(text) {
      return {
        text,
        mime: 'TEXT',
        setMimeType(m) {
          this.mime = m;
          return this;
        },
        getContent() {
          return this.text;
        },
      };
    },
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: () => null,
      setProperty: () => {},
      deleteProperty: () => {},
      getProperties: () => ({}),
    }),
    getUserProperties: () => ({
      getProperty: () => null,
      setProperty: () => {},
      deleteProperty: () => {},
      getProperties: () => ({}),
    }),
  };

  const Session = {
    getActiveUser: () => ({ getEmail: () => 'demo@example.com' }),
    getEffectiveUser: () => ({ getEmail: () => 'demo@example.com' }),
    getActiveUserLocale: () => 'en',
    getTimeZone: () => 'America/New_York',
  };

  const ScriptApp = {
    getProjectTriggers: () => [],
    newTrigger: (fn) => ({
      timeBased: () => ({
        everyDays: () => ({
          create: () => ({ getHandlerFunction: () => fn }),
        }),
      }),
    }),
  };

  return {
    SpreadsheetApp,
    Utilities,
    LockService,
    CacheService,
    ContentService,
    PropertiesService,
    Session,
    ScriptApp,
    sheetsMap,
    persist,
  };
}

let cachedCodeGs = null;

async function fetchCodeGs() {
  if (cachedCodeGs) return cachedCodeGs;
  const url = new URL('../setup/Code.gs', import.meta.url).href;
  if (url.startsWith('file:') && typeof process !== 'undefined') {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    cachedCodeGs = readFileSync(fileURLToPath(url), 'utf8');
    return cachedCodeGs;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load Code.gs: ${res.status}`);
  }
  cachedCodeGs = await res.text();
  return cachedCodeGs;
}

async function instantiateBackend() {
  const fakes = createBrowserFakes();

  // Method 1: Scope-isolated evaluation via new Function (as specified in TASK_AGY_DEMO.md)
  try {
    const code = await fetchCodeGs();
    const runner = new Function(
      'SpreadsheetApp',
      'Utilities',
      'LockService',
      'CacheService',
      'ContentService',
      'PropertiesService',
      'Session',
      'ScriptApp',
      code + '\nreturn { setup, doPost, doGet, runRetention, getSettings, updateSettings };'
    );

    const instance = runner(
      fakes.SpreadsheetApp,
      fakes.Utilities,
      fakes.LockService,
      fakes.CacheService,
      fakes.ContentService,
      fakes.PropertiesService,
      fakes.Session,
      fakes.ScriptApp
    );

    return { instance, fakes };
  } catch (err) {
    if (err.name !== 'EvalError' || typeof document === 'undefined') {
      throw err;
    }
  }

  // Method 2: CSP fallback for environments with script-src 'self' (disallowing unsafe-eval).
  // Injects <script src="..."> from 'self', attaching fakes to window scope.
  if (typeof window !== 'undefined') {
    window.SpreadsheetApp = fakes.SpreadsheetApp;
    window.Utilities = fakes.Utilities;
    window.LockService = fakes.LockService;
    window.CacheService = fakes.CacheService;
    window.ContentService = fakes.ContentService;
    window.PropertiesService = fakes.PropertiesService;
    window.Session = fakes.Session;
    window.ScriptApp = fakes.ScriptApp;

    if (!window.setup || !window.doPost) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('../setup/Code.js', import.meta.url).href;
        script.onload = () => resolve();
        script.onerror = (e) => reject(new Error('Failed to load Code.js via script tag: ' + e));
        document.head.appendChild(script);
      });
    }

    const instance = {
      setup: window.setup,
      doPost: window.doPost,
      doGet: window.doGet,
      runRetention: window.runRetention,
      getSettings: window.getSettings,
      updateSettings: window.updateSettings,
    };

    return { instance, fakes };
  }
}

// --- Demo Mode Control & Seeding ---

export function isDemo() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1' || params.get('demo') === 'true') {
      localStorage.setItem(DEMO_STORAGE_KEY, '1');
      params.delete('demo');
      const searchStr = params.toString() ? `?${params.toString()}` : '';
      window.history.replaceState({}, '', window.location.pathname + searchStr + window.location.hash);
      return true;
    }
  } catch (_) {}
  return localStorage.getItem(DEMO_STORAGE_KEY) === '1';
}

export function exitDemo() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DEMO_STORAGE_KEY);
  localStorage.removeItem(DEMO_SHEET_KEY);
  localStorage.removeItem(DEMO_CACHE_KEY);
  localStorage.removeItem('hb_my_band');
  clearMonitorSession();
  clearAdminSession();
}

let startDemoPromise = null;

/**
 * Seeds a realistic party:
 * - "Sample party: Friday 10 pm"
 * - 24 guests with diverse first and last names
 * - 30 bands
 * - about 12 checked in over the last 2 hours, 2 groups that left together, and 4 meetups
 * - Admin PIN 00000000, Door code DEMO42, Monitor "You"
 */
export async function startDemo(options = {}) {
  if (typeof localStorage === 'undefined') return;
  if (startDemoPromise) return startDemoPromise;

  startDemoPromise = (async () => {
    localStorage.setItem(DEMO_STORAGE_KEY, '1');
    localStorage.removeItem(DEMO_SHEET_KEY);
    localStorage.removeItem(DEMO_CACHE_KEY);

    const adminPin = DEMO_ADMIN_PIN;
    const monitorCode = DEMO_MONITOR_CODE;
    const eventName = options.name || 'Sample party: Friday 10 pm';

    saveAdminSession({ eventId: DEMO_EVENT_ID, adminPin, monitorCode });
    saveMonitorSession({
      token: DEMO_MONITOR_TOKEN,
      eventId: DEMO_EVENT_ID,
      eventName,
      name: 'You',
    });

    const { instance, fakes } = await instantiateBackend();

    // Run setup() to initialize tabs and settings
    instance.setup();
    const eventId = DEMO_EVENT_ID;

    // Customize settings for realistic demo
    const now = Date.now();
    const startsAt = options.startsAt || new Date(now - 2.5 * 3600 * 1000).toISOString();
    const endsAt = options.endsAt || new Date(now + 3.5 * 3600 * 1000).toISOString();

    instance.updateSettings({
      id: DEMO_EVENT_ID,
      eventName,
      adminPin,
      monitorCode,
      startsAt,
      endsAt,
    });

    // Register deterministic monitor session for "You" in cache
    fakes.CacheService.getScriptCache().put(
      'mon:' + DEMO_MONITOR_TOKEN,
      JSON.stringify({
        name: 'You',
        eventId: DEMO_EVENT_ID,
        createdAt: new Date().toISOString(),
      }),
      86400
    );

    saveAdminSession({ eventId, adminPin, monitorCode });
    saveMonitorSession({
      token: DEMO_MONITOR_TOKEN,
      eventId,
      eventName,
      name: 'You',
    });

    // Seed 24 guests with diverse first and last names
  const SEED_GUESTS = [
    { name: 'Maya Chen', over21: true },
    { name: 'Jordan Taylor', over21: true },
    { name: 'Sam Park', over21: false },
    { name: 'Elena Rostova', over21: true },
    { name: 'Marcus Johnson', over21: true },
    { name: 'Priya Patel', over21: true },
    { name: 'Lucas Silva', over21: true },
    { name: 'Chloe Lefevre', over21: false },
    { name: 'Devon Brooks', over21: true },
    { name: 'Aisha Al-Mansoor', over21: true },
    { name: 'Kai Tanaka', over21: true },
    { name: 'Sofia Rodriguez', over21: true },
    { name: 'Liam O\'Connor', over21: true },
    { name: 'Nina Kowalski', over21: true },
    { name: 'Jamal Washington', over21: true },
    { name: 'Zoe Lindqvist', over21: true },
    { name: 'Ethan Wright', over21: true },
    { name: 'Mia Takahashi', over21: true },
    { name: 'Noah Becker', over21: true },
    { name: 'Isabella Rossi', over21: true },
    { name: 'Gabriel Santos', over21: true },
    { name: 'Harper Lin', over21: true },
    { name: 'Tariq Khan', over21: true },
    { name: 'Emily Nguyen', over21: true },
  ];

  const guestsSheet = fakes.sheetsMap.get('Guests');
  const guestRecords = [];
  for (let i = 0; i < SEED_GUESTS.length; i++) {
    const g = SEED_GUESTS[i];
    const gid = 'gst_demo_' + (i + 1);
    const createdAt = new Date(now - (150 - i * 3) * 60 * 1000).toISOString();
    // Guests tab: ['name', 'phone', 'email', 'over21', 'idState', 'source', 'dob', 'idExpires', 'idHash', 'idScannedAt', 'createdAt', 'id']
    guestsSheet.appendRow([
      g.name,
      '',
      '',
      g.over21,
      'NY',
      'manual',
      '',
      '',
      '',
      '',
      createdAt,
      gid,
    ]);
    guestRecords.push({ id: gid, name: g.name });
  }

  // Create 30 bands
  const bandsRes = JSON.parse(
    instance.doPost({
      postData: {
        contents: JSON.stringify({
          action: 'createBands',
          auth: { adminPin },
          count: 30,
        }),
      },
    }).getContent()
  );

  const bands = bandsRes.bands || [];
  const bandsSheet = fakes.sheetsMap.get('Bands');

  // Link first 24 bands to the 24 guests
  for (let i = 0; i < guestRecords.length && i < bands.length; i++) {
    const band = bands[i];
    const guest = guestRecords[i];
    // Find row in Bands sheet (header is row 1)
    for (let r = 0; r < bandsSheet.rows.length; r++) {
      if (bandsSheet.rows[r][2] === band.token) {
        bandsSheet.rows[r][1] = guest.id; // guestId column
        break;
      }
    }
    band.guestId = guest.id;
  }
  fakes.persist();

  // Check in 16 guests over the last 2 hours (minutes ago: 110 down to 25)
  const checkinTimes = [110, 105, 100, 90, 85, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25];
  for (let i = 0; i < checkinTimes.length; i++) {
    const band = bands[i];
    const guest = guestRecords[i];
    const at = new Date(now - checkinTimes[i] * 60 * 1000).toISOString();
    instance.doPost({
      postData: {
        contents: JSON.stringify({
          action: 'scan',
          auth: { monitorToken: DEMO_MONITOR_TOKEN },
          shortCode: band.shortCode,
          direction: 'in',
          guestId: guest.id,
          at,
        }),
      },
    });
  }

  // 2 groups that left together:
  // Group 1: guests 12 & 13 (Liam & Nina) left 20 minutes ago
  const depTime1 = new Date(now - 20 * 60 * 1000).toISOString();
  instance.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'departures',
        auth: { monitorToken: DEMO_MONITOR_TOKEN },
        shortCodes: [bands[12].shortCode, bands[13].shortCode],
        at: depTime1,
      }),
    },
  });

  // Group 2: guests 14 & 15 (Jamal & Zoe) left 10 minutes ago
  const depTime2 = new Date(now - 10 * 60 * 1000).toISOString();
  instance.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'departures',
        auth: { monitorToken: DEMO_MONITOR_TOKEN },
        shortCodes: [bands[14].shortCode, bands[15].shortCode],
        at: depTime2,
      }),
    },
  });

  // 4 meetups among guests currently inside:
  // 1: Maya (0) + Jordan (1) 45 min ago
  instance.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'meet',
        myBandToken: bands[0].token,
        theirBandToken: bands[1].token,
        at: new Date(now - 45 * 60 * 1000).toISOString(),
      }),
    },
  });

  // 2: Maya (0) + Sam (2) 35 min ago
  instance.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'meet',
        myBandToken: bands[0].token,
        theirBandToken: bands[2].token,
        at: new Date(now - 35 * 60 * 1000).toISOString(),
      }),
    },
  });

  // 3: Elena (3) + Marcus (4) 25 min ago
  instance.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'meet',
        myBandToken: bands[3].token,
        theirBandToken: bands[4].token,
        at: new Date(now - 25 * 60 * 1000).toISOString(),
      }),
    },
  });

  // 4: Priya (5) + Lucas (6) 15 min ago
  instance.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'meet',
        myBandToken: bands[5].token,
        theirBandToken: bands[6].token,
        at: new Date(now - 15 * 60 * 1000).toISOString(),
      }),
    },
  });

  fakes.persist();

  return {
    ok: true,
    eventId,
    adminPin,
    monitorCode,
    sampleBandToken: bands[0]?.token,
  };
})().finally(() => {
  startDemoPromise = null;
});

return startDemoPromise;
}

/**
 * Runs an action in the browser fake backend with sheetsCall-compatible interface.
 */
export async function demoCall(action, args = {}) {
  // Ensure demo backend is initialized and seeded
  if (typeof localStorage !== 'undefined' && !localStorage.getItem(DEMO_SHEET_KEY)) {
    await startDemo();
  }

  const { instance } = await instantiateBackend();

  const auth = {};
  if (typeof localStorage !== 'undefined') {
    const mon = localStorage.getItem('hb_monitor_token');
    if (mon) auth.monitorToken = mon;
    const pin = localStorage.getItem('hb_admin_pin');
    if (pin) auth.adminPin = pin;
  }

  const requestId = args.requestId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  const payload = {
    action,
    auth,
    requestId,
    ...args,
  };

  const output = instance.doPost({
    postData: { contents: JSON.stringify(payload) },
  });

  const text = output.getContent();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(500, 'invalid_response', 'Invalid response from demo backend');
  }

  if (data && (data.error || (data.status && data.status >= 400))) {
    const status = data.status || 400;
    const error = data.error || 'error';
    const message = data.message || data.error || 'Demo request failed';
    throw new ApiError(status, error, message);
  }

  return data;
}
