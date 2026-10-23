/**
 * Homebound - Google Sheets Backend (Apps Script Web App)
 *
 * Implements the Homebound server contract for zero-server deployments.
 * Bound to the organizer's Google Sheet: one Sheet = one event.
 */

const BAND_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// --- Menu & Setup ---

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Homebound')
      .addItem('Setup event sheets', 'setup')
      .addItem('Install retention trigger', 'installRetention')
      .addToUi();
  } catch (_) {}
}

function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Settings tab
    let settingsSheet = ss.getSheetByName('Settings');
    let adminPin, monitorCode, secret, eventId;

    if (!settingsSheet) {
      settingsSheet = ss.insertSheet('Settings');
      adminPin = String(Math.floor(10000000 + Math.random() * 90000000));
      monitorCode = Array.from({ length: 6 }, () => BAND_ALPHABET[Math.floor(Math.random() * BAND_ALPHABET.length)]).join('');
      secret = randomSecretHex();
      eventId = randomToken();

      settingsSheet.appendRow(['Key', 'Value']);
      settingsSheet.appendRow(['id', eventId]);
      settingsSheet.appendRow(['eventName', 'Homebound Event']);
      settingsSheet.appendRow(['adminPin', adminPin]);
      settingsSheet.appendRow(['monitorCode', monitorCode]);
      settingsSheet.appendRow(['secret', secret]);
      settingsSheet.appendRow(['retentionDays', 30]);
      settingsSheet.appendRow(['startsAt', new Date().toISOString()]);
      settingsSheet.appendRow(['endsAt', '']);
      settingsSheet.appendRow(['capacity', '']);
      settingsSheet.appendRow(['createdAt', new Date().toISOString()]);
      formatSheetHeaders(settingsSheet);
    } else {
      const s = getSettings();
      adminPin = s.adminPin;
      monitorCode = s.monitorCode;
      secret = s.secret;
      eventId = s.id;
    }

    // Tab definitions with human-readable columns first
    const tabs = [
      {
        name: 'Guests',
        headers: ['name', 'phone', 'email', 'over21', 'idState', 'source', 'dob', 'idExpires', 'idHash', 'idScannedAt', 'createdAt', 'id'],
      },
      {
        name: 'Bands',
        headers: ['shortCode', 'guestId', 'token', 'createdAt'],
      },
      {
        name: 'Scans',
        headers: ['at', 'direction', 'shortCode', 'guestName', 'guestId', 'bandToken', 'monitorName'],
      },
      {
        name: 'Departures',
        headers: ['at', 'groupId', 'guestName', 'guestId', 'bandToken'],
      },
      {
        name: 'Audit',
        headers: ['at', 'actor', 'action', 'detail', 'id'],
      },
    ];

    for (const t of tabs) {
      let sheet = ss.getSheetByName(t.name);
      if (!sheet) {
        sheet = ss.insertSheet(t.name);
        sheet.appendRow(t.headers);
        formatSheetHeaders(sheet);
      }
    }

    // Remove empty default Sheet1 if present
    try {
      const defaultSheet = ss.getSheetByName('Sheet1');
      if (defaultSheet && ss.getSheets().length > 1) {
        ss.deleteSheet(defaultSheet);
      }
    } catch (_) {}

    audit(eventId, 'organizer', 'event_setup');

    try {
      const ui = SpreadsheetApp.getUi();
      ui.alert(
        'Homebound Event Setup Complete!\n\n' +
        `Admin PIN: ${adminPin}\n` +
        `Monitor Code: ${monitorCode}\n\n` +
        'Keep your Admin PIN secret. Door monitors use the Monitor Code.'
      );
    } catch (_) {}

    return { ok: true, adminPin, monitorCode, eventId };
  } finally {
    lock.releaseLock();
  }
}

function formatSheetHeaders(sheet) {
  try {
    const lastCol = sheet.getLastColumn() || 1;
    sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } catch (_) {}
}

// --- Data Access Helpers ---

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function getRows(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0].map(h => String(h).trim());
  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const rowObj = { _rowIndex: r + 1 };
    let hasVal = false;
    for (let c = 0; c < headers.length; c++) {
      const val = data[r][c];
      rowObj[headers[c]] = val;
      if (val !== '' && val !== null && val !== undefined) hasVal = true;
    }
    if (hasVal) rows.push(rowObj);
  }
  return rows;
}

function appendRow(sheetName, obj) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const row = headers.map(h => {
    const v = obj[h];
    return v !== undefined && v !== null ? v : '';
  });
  sheet.appendRow(row);
}

function updateRow(sheetName, rowIndex, updates) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  for (const [k, v] of Object.entries(updates)) {
    const colIdx = headers.indexOf(k);
    if (colIdx >= 0) {
      sheet.getRange(rowIndex, colIdx + 1).setValue(v !== undefined && v !== null ? v : '');
    }
  }
}

function getSettings() {
  const sheet = getSheet('Settings');
  const values = sheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0]).trim();
    if (key) {
      settings[key] = values[i][1];
    }
  }
  return settings;
}

function updateSettings(updates) {
  const sheet = getSheet('Settings');
  const values = sheet.getDataRange().getValues();
  const keys = [];
  for (let i = 1; i < values.length; i++) {
    keys.push(String(values[i][0]).trim());
  }
  for (const [key, val] of Object.entries(updates)) {
    const idx = keys.indexOf(key);
    if (idx >= 0) {
      sheet.getRange(idx + 2, 2).setValue(val !== undefined && val !== null ? String(val) : '');
    } else {
      sheet.appendRow([key, val !== undefined && val !== null ? String(val) : '']);
      keys.push(key);
    }
  }
}

function audit(eventId, actor, action, detail) {
  try {
    appendRow('Audit', {
      at: new Date().toISOString(),
      actor: actor || 'system',
      action: action || '',
      detail: detail ? JSON.stringify(detail) : '',
      id: randomToken(),
    });
  } catch (_) {}
}

// --- Cryptography & IDs ---

function randomToken() {
  let hex = '';
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

function randomSecretHex() {
  let hex = '';
  for (let i = 0; i < 64; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

function shortCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += BAND_ALPHABET.charAt(Math.floor(Math.random() * BAND_ALPHABET.length));
  }
  return code;
}

function computeHmacSha256Hex(key, value) {
  const sig = Utilities.computeHmacSha256Signature(String(value), String(key));
  let hex = '';
  for (let i = 0; i < sig.length; i++) {
    const b = sig[i] < 0 ? sig[i] + 256 : sig[i];
    const s = b.toString(16);
    hex += s.length === 1 ? '0' + s : s;
  }
  return hex;
}

// --- CSV Parsing & Escaping ---

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

const clean = s => String(s ?? '').trim();
const headerNorm = s => clean(s).replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const attendingSet = new Set(['approved', 'going', 'yes', 'attending', 'checked_in']);
const declinedSet = new Set(['declined', 'cant_go', 'not_going', 'no']);
const getStatusReason = value => {
  const status = clean(value).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (attendingSet.has(status)) return null;
  if (declinedSet.has(status)) return 'declined';
  if (status === 'waitlist' || status === 'waitlisted') return 'waitlist';
  if (status === 'pending_approval') return 'pending_approval';
  if (status === 'invited') return 'invited';
  if (status === 'maybe') return 'maybe';
  return 'unknown_status';
};

function parseGuestCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('CSV is empty');
  const names = rows.shift().map(headerNorm);
  const find = (...options) => names.findIndex(n => options.includes(n));
  const nameCol = find('name', 'fullname', 'guestname', 'attendeename', 'guestfullname');
  const firstCol = find('firstname', 'guestfirstname', 'first');
  const lastCol = find('lastname', 'guestlastname', 'last');
  const emailCol = find('email', 'emailaddress', 'guestemail', 'attendeeemail');
  const phoneCol = find('phone', 'phonenumber', 'mobile', 'guestphone', 'mobilenumber');
  const statusCol = find('approvalstatus', 'status', 'rsvp');
  if (nameCol < 0 && firstCol < 0) throw new Error('CSV needs a name column');
  return rows.map(row => ({
    name: clean((nameCol >= 0 && row[nameCol]) || `${row[firstCol] ?? ''} ${row[lastCol] ?? ''}`),
    email: emailCol < 0 ? null : clean(row[emailCol]) || null,
    phone: phoneCol < 0 ? null : clean(row[phoneCol]) || null,
    skipReason: statusCol < 0 ? null : getStatusReason(row[statusCol]),
  }));
}

function csvEscape(value) {
  const s = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// --- ID Check-in Matching ---

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function ageAndExpiry(dob, idExpires, eventStartsAt) {
  const eventDate = (eventStartsAt || new Date().toISOString()).slice(0, 10);
  const twentyFirst = `${Number(dob.slice(0, 4)) + 21}${dob.slice(4)}`;
  return { over21: eventDate >= twentyFirst, expired: idExpires < eventDate };
}

const normalizeName = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const nameParts = name => {
  const reordered = name.includes(',') ? name.split(',').reverse().join(' ') : name;
  const words = normalizeName(reordered).split(' ').filter(Boolean);
  return { first: words[0] || '', last: words[words.length - 1] || '' };
};

function distanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

function matchGuestsList(guests, firstName, lastName) {
  const target = nameParts(`${firstName} ${lastName}`);
  const exact = guests.filter(g => {
    const p = nameParts(g.name);
    return p.first === target.first && p.last === target.last;
  });
  if (exact.length) return exact;
  return guests.filter(g => {
    const p = nameParts(g.name);
    return p.first && p.last && distanceAtMostOne(p.first, target.first) && distanceAtMostOne(p.last, target.last);
  });
}

// --- Action Implementations ---

function verifyAdmin(settings, pin) {
  if (!pin || String(pin).trim() !== String(settings.adminPin).trim()) {
    throw { status: 401, error: 'unauthorized', message: 'Admin PIN invalid or required' };
  }
  return { actor: 'organizer', name: 'organizer' };
}

function verifyMonitorOrAdmin(settings, token, pin) {
  if (pin && String(pin).trim() === String(settings.adminPin).trim()) {
    return { actor: 'organizer', name: 'organizer' };
  }
  if (!token) {
    throw { status: 401, error: 'unauthorized', message: 'Monitor token required' };
  }
  let session = null;
  try {
    const cached = CacheService.getScriptCache().get('mon:' + token);
    if (cached) {
      session = JSON.parse(cached);
    }
  } catch (_) {}

  if (!session) {
    throw { status: 401, error: 'invalid_token', message: 'Monitor session expired or invalid' };
  }
  return { actor: session.name, name: session.name };
}

function handleSearchGuests(settings, q) {
  const query = String(q || '').trim().toLowerCase();
  if (query.length > 100) {
    throw { status: 400, error: 'invalid_query', message: 'Query too long' };
  }
  const guests = getRows('Guests');
  const bands = getRows('Bands');
  const scans = getRows('Scans');

  const bandByGuest = new Map(bands.filter(b => b.guestId).map(b => [String(b.guestId), b]));
  const matched = [];

  for (const g of guests) {
    if (!query || g.name.toLowerCase().includes(query)) {
      const gid = String(g.id);
      const band = bandByGuest.get(gid);
      let isInside = false;
      if (band) {
        const bandScans = scans.filter(s => s.bandToken === band.token);
        const lastScan = bandScans[bandScans.length - 1];
        isInside = lastScan?.direction === 'in';
      }
      matched.push({
        id: g.id,
        name: g.name,
        ...(band ? { band: band.shortCode } : {}),
        inside: isInside,
        ...(g.over21 !== '' && g.over21 !== null && g.over21 !== undefined ? { over21: Boolean(g.over21 === true || g.over21 === 1 || g.over21 === 'true' || g.over21 === '1') } : {})
      });
      if (matched.length >= 100) break;
    }
  }
  return matched;
}

function handleIdCheckin(settings, actor, body) {
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const dob = String(body.dob || '').trim();
  const idState = String(body.idState || '').trim();
  const idExpires = String(body.idExpires || '').trim();
  const licenseNumber = String(body.licenseNumber || '').trim();

  if (!firstName || firstName.length > 100 || !lastName || lastName.length > 100 ||
      !validDate(dob) || !validDate(idExpires) ||
      !/^[A-Za-z]{2}$/.test(idState) ||
      !licenseNumber || licenseNumber.length > 80 || /[\x00-\x1f\x7f]/.test(licenseNumber)) {
    throw { status: 400, error: 'invalid_id_fields', message: 'Invalid ID fields' };
  }

  const eventStart = (settings.startsAt || new Date().toISOString()).slice(0, 10);
  if (dob > eventStart) {
    throw { status: 400, error: 'invalid_id_fields', message: 'DOB cannot be after event start' };
  }

  const { over21, expired } = ageAndExpiry(dob, idExpires, settings.startsAt);
  const canonicalState = idState.toUpperCase();
  const canonicalNumber = licenseNumber.toUpperCase().replace(/\s+/g, '');
  const idHash = computeHmacSha256Hex(settings.secret, settings.id + canonicalState + canonicalNumber);

  const guests = getRows('Guests');
  const previous = guests.find(g => g.idHash === idHash);
  if (previous) {
    audit(settings.id, actor, 'id_duplicate', { guestId: previous.id });
    return {
      guest: { id: previous.id, name: previous.name },
      over21,
      expired,
      duplicate: { guestId: previous.id, at: previous.idScannedAt }
    };
  }

  const matches = matchGuestsList(guests, firstName, lastName);
  if (matches.length > 1) {
    audit(settings.id, actor, 'id_ambiguous', { candidates: matches.length });
    return {
      candidates: matches.map(g => ({ id: g.id, name: g.name })),
      over21,
      expired
    };
  }

  let guest, created = false;
  const now = new Date().toISOString();
  if (matches.length === 1) {
    guest = matches[0];
    if (guest.idHash) {
      throw { status: 409, error: 'id_already_verified', message: 'ID already verified for this guest' };
    }
    updateRow('Guests', guest._rowIndex, {
      dob,
      over21: Number(over21),
      idState: canonicalState,
      idExpires,
      idHash,
      idScannedAt: now,
    });
  } else {
    const fullName = `${firstName} ${lastName}`;
    const newId = randomToken();
    guest = { id: newId, name: fullName };
    created = true;
    appendRow('Guests', {
      id: newId,
      name: fullName,
      email: '',
      phone: '',
      source: 'id',
      dob,
      over21: Number(over21),
      idState: canonicalState,
      idExpires,
      idHash,
      idScannedAt: now,
      createdAt: now,
    });
  }

  audit(settings.id, actor, 'id_checkin', { guestId: guest.id, created });
  return {
    guest: { id: guest.id, name: guest.name },
    ...(created ? { created: true } : {}),
    over21,
    expired
  };
}

function handleScan(settings, actor, body) {
  const direction = body.direction;
  if (direction !== 'in' && direction !== 'out') {
    throw { status: 400, error: 'invalid_scan', message: 'Direction must be in or out' };
  }
  const bandToken = body.bandToken;
  const shortCodeInput = body.shortCode ? String(body.shortCode).trim().toUpperCase() : null;
  if (!bandToken && !shortCodeInput) {
    throw { status: 400, error: 'invalid_scan', message: 'Band token or short code required' };
  }

  const bands = getRows('Bands');
  const band = bands.find(b => bandToken ? b.token === bandToken : b.shortCode === shortCodeInput);
  if (!band) {
    throw { status: 404, error: 'band_not_found', message: 'Band not found' };
  }

  let timestamp = new Date().toISOString();
  if (body.at !== undefined) {
    const clientTime = Date.parse(body.at);
    if (typeof body.at !== 'string' || !Number.isFinite(clientTime) || Math.abs(clientTime - Date.parse(timestamp)) > 12 * 3600000) {
      throw { status: 400, error: 'invalid_scan_time', message: 'Invalid scan timestamp' };
    }
    timestamp = new Date(clientTime).toISOString();
  }

  const scans = getRows('Scans');
  const bandScans = scans.filter(s => s.bandToken === band.token);
  const previous = bandScans[bandScans.length - 1];

  if (direction === 'in' && !band.guestId && !body.guestId) {
    return { needsGuest: true, band: { shortCode: band.shortCode } };
  }
  if (!band.guestId && direction === 'out') {
    throw { status: 409, error: 'unlinked_band', message: 'Band is not linked to a guest' };
  }
  if (band.guestId && body.guestId && String(band.guestId) !== String(body.guestId)) {
    throw { status: 409, error: 'band_already_linked', message: 'Band is already linked to another guest' };
  }

  if (!band.guestId) {
    const guests = getRows('Guests');
    const g = guests.find(guest => String(guest.id) === String(body.guestId));
    if (!g) {
      throw { status: 404, error: 'guest_not_found', message: 'Guest not found' };
    }
    const alreadyLinked = bands.some(b => String(b.guestId) === String(g.id));
    if (alreadyLinked) {
      throw { status: 409, error: 'guest_already_linked', message: 'Guest is already linked to a band' };
    }
    updateRow('Bands', band._rowIndex, { guestId: g.id });
    band.guestId = g.id;
  }

  const guests = getRows('Guests');
  const guest = guests.find(g => String(g.id) === String(band.guestId));
  if (!guest) {
    throw { status: 404, error: 'guest_not_found', message: 'Guest not found' };
  }

  const warning = (direction === 'in' && previous?.direction === 'in')
    ? 'already_inside'
    : (direction === 'out' && previous?.direction !== 'in')
    ? 'not_inside'
    : undefined;

  if (!warning) {
    appendRow('Scans', {
      at: timestamp,
      direction,
      shortCode: band.shortCode,
      guestName: guest.name,
      guestId: guest.id,
      bandToken: band.token,
      monitorName: actor,
    });
  }

  return {
    guest: { id: guest.id, name: guest.name },
    inside: warning ? previous?.direction === 'in' : direction === 'in',
    at: timestamp,
    ...(warning ? { warning } : {})
  };
}

function handleDepartures(settings, actor, body) {
  const values = Array.isArray(body.bandTokens) ? body.bandTokens : body.shortCodes;
  const byCode = !Array.isArray(body.bandTokens);
  if (!Array.isArray(values) || !values.length || values.length > 30 || values.some(v => typeof v !== 'string' || !v.trim())) {
    throw { status: 400, error: 'invalid_departure', message: 'Invalid departures list' };
  }

  const allBands = getRows('Bands');
  const matchedBands = [];
  for (const v of values) {
    const val = byCode ? v.trim().toUpperCase() : v.trim();
    const b = allBands.find(band => byCode ? band.shortCode === val : band.token === val);
    if (!b) throw { status: 404, error: 'band_not_found', message: `Band not found: ${v}` };
    matchedBands.push(b);
  }

  const tokenSet = new Set(matchedBands.map(b => b.token));
  if (tokenSet.size !== matchedBands.length) {
    throw { status: 400, error: 'duplicate_band', message: 'Duplicate band in departure' };
  }
  if (matchedBands.some(b => !b.guestId)) {
    throw { status: 409, error: 'unlinked_band', message: 'All bands must be linked to guests' };
  }

  const guests = getRows('Guests');
  const guestMap = new Map(guests.map(g => [String(g.id), g]));
  const people = matchedBands.map(b => {
    const g = guestMap.get(String(b.guestId));
    return { id: g.id, name: g.name };
  });

  const groupId = randomToken();
  const timestamp = new Date().toISOString();
  const scans = getRows('Scans');

  for (const band of matchedBands) {
    const bandScans = scans.filter(s => s.bandToken === band.token);
    const lastScan = bandScans[bandScans.length - 1];
    const isInside = lastScan?.direction === 'in';
    const guest = guestMap.get(String(band.guestId));

    if (isInside) {
      appendRow('Scans', {
        at: timestamp,
        direction: 'out',
        shortCode: band.shortCode,
        guestName: guest.name,
        guestId: guest.id,
        bandToken: band.token,
        monitorName: actor,
      });
    }

    appendRow('Departures', {
      at: timestamp,
      groupId,
      guestName: guest.name,
      guestId: guest.id,
      bandToken: band.token,
    });
  }

  return {
    groupId,
    people: people.map(p => ({ name: p.name }))
  };
}

function handleDashboard(settings) {
  const guests = getRows('Guests');
  const bands = getRows('Bands');
  const scans = getRows('Scans');
  const deps = getRows('Departures');

  const bandByGuest = new Map(bands.filter(b => b.guestId).map(b => [String(b.guestId), b]));
  const groupPeople = new Map();
  for (const d of deps) {
    if (!groupPeople.has(d.groupId)) groupPeople.set(d.groupId, []);
    groupPeople.get(d.groupId).push(String(d.guestId));
  }
  const names = new Map(guests.map(g => [String(g.id), g.name]));

  let insideCount = 0;
  let checkedInCount = 0;

  const roster = guests.map(g => {
    const gid = String(g.id);
    const band = bandByGuest.get(gid);
    const gs = scans.filter(s => String(s.guestId) === gid);
    const last = gs[gs.length - 1];
    const dep = deps.filter(d => String(d.guestId) === gid).pop();
    const status = last?.direction === 'in' ? 'inside' : last ? 'left' : 'not_arrived';

    if (gs.some(s => s.direction === 'in')) {
      checkedInCount++;
    }
    if (status === 'inside') {
      insideCount++;
    }

    const firstIn = gs.find(s => s.direction === 'in');
    const mates = dep && groupPeople.has(dep.groupId)
      ? groupPeople.get(dep.groupId).filter(id => id !== gid).map(id => names.get(id)).filter(Boolean)
      : [];

    return {
      name: g.name,
      band: band?.shortCode || null,
      status,
      ...(firstIn ? { inAt: firstIn.at } : {}),
      ...(last?.direction === 'out' ? { outAt: last.at } : {}),
      ...(dep && mates.length ? { leftWith: mates } : {})
    };
  });

  const leftCount = Math.max(0, checkedInCount - insideCount);

  const recentDepartures = [];
  const seenGroups = new Set();
  for (let i = deps.length - 1; i >= 0; i--) {
    const d = deps[i];
    if (!seenGroups.has(d.groupId)) {
      seenGroups.add(d.groupId);
      const peopleIds = groupPeople.get(d.groupId) || [];
      recentDepartures.push({
        at: d.at,
        people: peopleIds.map(id => names.get(id)).filter(Boolean)
      });
      if (recentDepartures.length >= 20) break;
    }
  }

  return {
    event: {
      id: settings.id,
      name: settings.eventName,
      capacity: settings.capacity ? Number(settings.capacity) : null
    },
    inside: insideCount,
    checkedIn: checkedInCount,
    left: leftCount,
    roster,
    recentDepartures
  };
}

function handleAddGuest(settings, name, email, phone) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName || trimmedName.length > 200) {
    throw { status: 400, error: 'invalid_guest', message: 'Guest name is required' };
  }
  const id = randomToken();
  const now = new Date().toISOString();
  appendRow('Guests', {
    id,
    name: trimmedName,
    email: email ? String(email).trim() : '',
    phone: phone ? String(phone).trim() : '',
    source: 'manual',
    dob: '',
    over21: '',
    idState: '',
    idExpires: '',
    idHash: '',
    idScannedAt: '',
    createdAt: now,
  });
  return { guest: { id, name: trimmedName } };
}

function handleGetEvent(settings) {
  const guests = getRows('Guests');
  const bands = getRows('Bands');
  const scans = getRows('Scans');
  const deps = getRows('Departures');

  const checkedIn = new Set(scans.filter(s => s.direction === 'in').map(s => String(s.guestId))).size;
  const lastScanByBand = new Map();
  for (const s of scans) {
    lastScanByBand.set(s.bandToken, s.direction);
  }
  let inside = 0;
  for (const dir of lastScanByBand.values()) {
    if (dir === 'in') inside++;
  }
  const left = Math.max(0, checkedIn - inside);
  const groups = new Set(deps.map(d => d.groupId)).size;

  return {
    event: {
      id: settings.id,
      name: settings.eventName,
      capacity: settings.capacity ? Number(settings.capacity) : null,
      startsAt: settings.startsAt,
      endsAt: settings.endsAt || null,
      monitorCode: settings.monitorCode,
    },
    stats: {
      guests: guests.length,
      bands: bands.length,
      inside,
      checkedIn,
      left,
      groups,
    }
  };
}

function handleImportCsv(settings, csvContent) {
  if (!csvContent || typeof csvContent !== 'string') {
    throw { status: 400, error: 'invalid_csv', message: 'CSV content required' };
  }
  let rows;
  try {
    rows = parseGuestCsv(csvContent);
  } catch (err) {
    throw { status: 400, error: 'invalid_csv', message: err.message };
  }

  const existingGuests = getRows('Guests');
  const seenEmails = new Set(existingGuests.filter(g => g.email).map(g => g.email.toLowerCase()));
  const seenNamePhone = new Set(existingGuests.map(g => `${g.name.toLowerCase()}|${g.phone || ''}`));

  let imported = 0;
  let skipped = 0;
  const skippedReasons = {};
  const skip = reason => {
    skipped++;
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
  };

  const now = new Date().toISOString();
  for (const g of rows) {
    if (g.skipReason) {
      skip(g.skipReason);
      continue;
    }
    if (!g.name || g.name.length > 200) {
      skip('missing_name');
      continue;
    }
    const emailKey = g.email ? g.email.toLowerCase() : null;
    const namePhoneKey = `${g.name.toLowerCase()}|${g.phone || ''}`;

    if ((emailKey && seenEmails.has(emailKey)) || seenNamePhone.has(namePhoneKey)) {
      skip('duplicate');
      continue;
    }

    if (emailKey) seenEmails.add(emailKey);
    seenNamePhone.add(namePhoneKey);

    const id = randomToken();
    appendRow('Guests', {
      id,
      name: g.name,
      email: g.email || '',
      phone: g.phone || '',
      source: 'partiful',
      dob: '',
      over21: '',
      idState: '',
      idExpires: '',
      idHash: '',
      idScannedAt: '',
      createdAt: now,
    });
    imported++;
  }

  audit(settings.id, 'organizer', 'csv_import', { imported, skipped, skippedReasons });
  return { imported, skipped, skippedReasons };
}

function handleCreateBands(settings, count, siteUrl) {
  const num = parseInt(count, 10);
  if (!Number.isInteger(num) || num < 1 || num > 2000) {
    throw { status: 400, error: 'invalid_count', message: 'Count must be between 1 and 2000' };
  }

  const existingBands = getRows('Bands');
  const existingCodes = new Set(existingBands.map(b => b.shortCode));
  const newBands = [];
  const now = new Date().toISOString();
  const siteBase = siteUrl || settings.siteUrl || 'https://bryanzhao08.github.io/safety-bracelet';

  for (let i = 0; i < num; i++) {
    let code;
    do {
      code = shortCode();
    } while (existingCodes.has(code));
    existingCodes.add(code);
    const token = randomToken();
    const url = `${siteBase}/t/?b=${token}`;
    appendRow('Bands', {
      shortCode: code,
      guestId: '',
      token: token,
      createdAt: now,
    });
    newBands.push({ token, shortCode: code, url });
  }

  audit(settings.id, 'organizer', 'bands_created', { count: num });
  return { bands: newBands };
}

function handleBandsCsv(settings) {
  const bands = getRows('Bands');
  const siteUrl = settings.siteUrl || 'https://bryanzhao08.github.io/safety-bracelet';
  let out = 'shortCode,url\r\n';
  for (const b of bands) {
    out += `${b.shortCode},${siteUrl}/t/?b=${b.token}\r\n`;
  }
  return { csv: out };
}

function handleExportCsv(settings) {
  const guests = getRows('Guests');
  const bands = getRows('Bands');
  const scans = getRows('Scans');
  const deps = getRows('Departures');

  const byGroup = new Map();
  for (const d of deps) {
    if (!byGroup.has(d.groupId)) byGroup.set(d.groupId, []);
    byGroup.get(d.groupId).push(d);
  }
  const byId = new Map(guests.map(g => [String(g.id), g]));

  const lines = ['name,email,phone,band,first in,last out,left with'];
  for (const g of guests) {
    const gid = String(g.id);
    const gb = bands.filter(b => String(b.guestId) === gid);
    const gs = scans.filter(s => String(s.guestId) === gid);
    const gd = deps.filter(d => String(d.guestId) === gid);
    const first = gs.find(s => s.direction === 'in')?.at || '';
    const lastOut = gs.filter(s => s.direction === 'out').pop();
    const last = lastOut?.at || '';
    const latestDep = gd.pop();
    const mates = latestDep ? (byGroup.get(latestDep.groupId) || [])
      .filter(d => String(d.guestId) !== gid)
      .map(d => byId.get(String(d.guestId))?.name)
      .filter(Boolean) : [];

    lines.push([
      g.name,
      g.email || '',
      g.phone || '',
      gb.map(b => b.shortCode).join('; '),
      first,
      last,
      mates.join('; ')
    ].map(csvEscape).join(','));
  }
  return { csv: lines.join('\r\n') + '\r\n' };
}

function handleTimeline(settings, guestId) {
  const guests = getRows('Guests');
  const guest = guests.find(g => String(g.id) === String(guestId));
  if (!guest) throw { status: 404, error: 'guest_not_found', message: 'Guest not found' };

  const bands = getRows('Bands');
  const band = bands.find(b => String(b.guestId) === String(guest.id));

  const scans = getRows('Scans').filter(s => String(s.guestId) === String(guest.id));
  const departures = getRows('Departures');
  const guestDeps = departures.filter(d => String(d.guestId) === String(guest.id));
  const byId = new Map(guests.map(g => [String(g.id), g]));

  const companions = groupId => departures
    .filter(d => d.groupId === groupId && String(d.guestId) !== String(guest.id))
    .map(d => {
      const g = byId.get(String(d.guestId));
      return g ? { name: g.name, phone: g.phone } : null;
    }).filter(Boolean);

  const events = scans.map(scan => ({
    at: scan.at,
    type: scan.direction,
    detail: { band: scan.shortCode, monitorName: scan.monitorName }
  }));

  for (const dep of guestDeps) {
    events.push({
      at: dep.at,
      type: 'departure',
      detail: {
        band: band?.shortCode,
        groupId: dep.groupId,
        leftWith: companions(dep.groupId).map(p => p.name)
      }
    });
  }

  if (guest.idScannedAt) {
    events.push({
      at: guest.idScannedAt,
      type: 'id_check',
      detail: { over21: Boolean(guest.over21 === true || guest.over21 === 1 || guest.over21 === 'true' || guest.over21 === '1') }
    });
  }

  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const lastDep = guestDeps.pop();
  const leftWith = lastDep ? companions(lastDep.groupId).map(p => ({
    name: p.name,
    ...(p.phone ? { phone: p.phone } : {})
  })) : [];

  const inScans = scans.filter(s => s.direction === 'in');
  const lastInside = inScans.length ? inScans[inScans.length - 1].at : undefined;

  return {
    guest: {
      name: guest.name,
      email: guest.email || null,
      phone: guest.phone || null,
      ...(guest.over21 !== '' && guest.over21 !== null && guest.over21 !== undefined ? { over21: Boolean(guest.over21 === true || guest.over21 === 1 || guest.over21 === 'true' || guest.over21 === '1') } : {}),
      ...(guest.idState ? { idState: guest.idState } : {})
    },
    ...(band ? { band: { shortCode: band.shortCode } } : {}),
    events,
    leftWith,
    ...(lastInside ? { lastSeenInsideAt: lastInside } : {})
  };
}

function handleUpdateEvent(settings, updates) {
  const up = {};
  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name || name.length > 120) throw { status: 400, error: 'invalid_event', message: 'Invalid event name' };
    up.eventName = name;
  }
  if (updates.capacity !== undefined) {
    const cap = parseInt(updates.capacity, 10);
    if (!Number.isInteger(cap) || cap < 1) throw { status: 400, error: 'invalid_event', message: 'Capacity must be >= 1' };
    up.capacity = cap;
  }
  if (updates.startsAt !== undefined) {
    up.startsAt = new Date(updates.startsAt).toISOString();
  }
  if (updates.endsAt !== undefined) {
    up.endsAt = new Date(updates.endsAt).toISOString();
  }
  if (updates.retentionDays !== undefined) {
    up.retentionDays = parseInt(updates.retentionDays, 10);
  }
  if (updates.siteUrl !== undefined) {
    up.siteUrl = String(updates.siteUrl);
  }
  updateSettings(up);
  const updated = getSettings();
  audit(updated.id, 'organizer', 'event_updated', up);
  return {
    event: {
      id: updated.id,
      name: updated.eventName,
      capacity: updated.capacity ? Number(updated.capacity) : null,
    }
  };
}

function handleEndEvent(settings) {
  const now = new Date().toISOString();
  updateSettings({ endsAt: now });
  audit(settings.id, 'organizer', 'event_ended');
  return { endsAt: now };
}

// --- Retention Job & Triggers ---

function installRetention() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'runRetention') {
      return { ok: true, message: 'Retention trigger already installed' };
    }
  }
  ScriptApp.newTrigger('runRetention')
    .timeBased()
    .everyDays(1)
    .create();
  return { ok: true, message: 'Retention trigger installed' };
}

function runRetention() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const settings = getSettings();
    if (!settings.endsAt) return;
    const retentionDays = parseInt(settings.retentionDays || '30', 10);
    const endsMs = Date.parse(settings.endsAt);
    if (!Number.isFinite(endsMs)) return;
    if (Date.now() - endsMs <= retentionDays * 86400000) return;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const clearRows = (sheetName) => {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet && sheet.getLastRow() > 1) {
        sheet.deleteRows(2, sheet.getLastRow() - 1);
      }
    };
    clearRows('Guests');
    clearRows('Bands');
    clearRows('Scans');
    clearRows('Departures');

    audit(settings.id, 'retention', 'data_purged', { purgedAt: new Date().toISOString() });
  } finally {
    lock.releaseLock();
  }
}

// --- HTTP Request Handlers ---

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'homebound-sheets' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const contents = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(contents);
    const action = body.action;
    const authHeader = body.auth || {};
    const adminPin = authHeader.adminPin || body.adminPin;
    const monitorToken = authHeader.monitorToken || body.monitorToken;
    const requestId = body.requestId || body.idempotencyKey;

    if (requestId) {
      try {
        const cached = CacheService.getScriptCache().get('idem:' + requestId);
        if (cached) {
          return ContentService.createTextOutput(cached)
            .setMimeType(ContentService.MimeType.JSON);
        }
      } catch (_) {}
    }

    const settings = getSettings();
    if (!settings.id) {
      if (action !== 'ping' && action !== 'setup' && action !== 'pilot') {
        throw { status: 400, error: 'event_not_setup', message: 'Run setup() first in the Google Sheet' };
      }
    }

    let result;
    const writeActions = ['pilot', 'setup', 'addGuest', 'idCheckin', 'scan', 'departures', 'importCsv', 'createBands', 'updateEvent', 'endEvent'];
    const isWrite = writeActions.includes(action);

    let lock = null;
    if (isWrite) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }

    try {
      switch (action) {
        case 'pilot': {
          // Public pilot sign-up from the marketing site. Apps Script can't see the caller's IP,
          // so cap total sign-ups per hour instead.
          const cache = CacheService.getScriptCache();
          const count = Number(cache.get('pilot:hour') || 0);
          if (count >= 50) throw { status: 429, error: 'rate_limited', message: 'Too many requests. Try again in an hour.' };
          const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
          const email = clean(body.email, 200);
          if (!clean(body.chapter, 200) || !clean(body.school, 200) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            throw { status: 400, error: 'invalid_pilot', message: 'Chapter, school and a valid email are required.' };
          }
          const sheet = getSheet('Pilot');
          if (sheet.getLastRow() === 0) sheet.appendRow(['at', 'chapter', 'school', 'email', 'eventSize', 'note']);
          // Prefix values that a spreadsheet would treat as formulas
          const safe = v => /^[=+\-@]/.test(v) ? "'" + v : v;
          sheet.appendRow([new Date().toISOString(), safe(clean(body.chapter, 200)), safe(clean(body.school, 200)),
            safe(email), Number(body.eventSize) || '', safe(clean(body.note, 1000))]);
          cache.put('pilot:hour', String(count + 1), 3600);
          result = { ok: true };
          break;
        }

        case 'ping':
          result = { ok: true, eventName: settings.eventName || 'Homebound Event', eventId: settings.id || null };
          break;

        case 'monitorSession': {
          const monitorCode = String(body.monitorCode || '').trim().toUpperCase();
          const name = String(body.name || '').trim();
          if (!name || name.length > 80 || !monitorCode || monitorCode !== settings.monitorCode) {
            throw { status: 403, error: 'invalid_monitor_code', message: 'Invalid monitor code' };
          }
          const token = computeHmacSha256Hex(settings.secret, `${name}:${Date.now()}:${Math.random()}`);
          try {
            CacheService.getScriptCache().put('mon:' + token, JSON.stringify({
              name,
              eventId: settings.id,
              createdAt: new Date().toISOString()
            }), 86400); // 24 hours
          } catch (_) {}
          result = {
            monitorToken: token,
            event: { id: settings.id, name: settings.eventName }
          };
          break;
        }

        // Monitor actions
        case 'searchGuests': {
          verifyMonitorOrAdmin(settings, monitorToken, adminPin);
          result = handleSearchGuests(settings, body.q);
          break;
        }

        case 'idCheckin': {
          const actor = verifyMonitorOrAdmin(settings, monitorToken, adminPin);
          result = handleIdCheckin(settings, actor.name, body);
          break;
        }

        case 'scan': {
          const actor = verifyMonitorOrAdmin(settings, monitorToken, adminPin);
          result = handleScan(settings, actor.name, body);
          break;
        }

        case 'departures': {
          const actor = verifyMonitorOrAdmin(settings, monitorToken, adminPin);
          result = handleDepartures(settings, actor.name, body);
          break;
        }

        case 'dashboard': {
          verifyMonitorOrAdmin(settings, monitorToken, adminPin);
          result = handleDashboard(settings);
          break;
        }

        case 'addGuest': {
          verifyMonitorOrAdmin(settings, monitorToken, adminPin);
          result = handleAddGuest(settings, body.name, body.email, body.phone);
          break;
        }

        // Admin actions
        case 'event':
        case 'getEvent': {
          verifyAdmin(settings, adminPin);
          result = handleGetEvent(settings);
          break;
        }

        case 'importCsv': {
          verifyAdmin(settings, adminPin);
          result = handleImportCsv(settings, body.csvContent || body.csv);
          break;
        }

        case 'createBands': {
          verifyAdmin(settings, adminPin);
          result = handleCreateBands(settings, body.count, body.siteUrl);
          break;
        }

        case 'bandsCsv': {
          verifyAdmin(settings, adminPin);
          result = handleBandsCsv(settings);
          break;
        }

        case 'exportCsv': {
          verifyAdmin(settings, adminPin);
          result = handleExportCsv(settings);
          break;
        }

        case 'timeline': {
          verifyAdmin(settings, adminPin);
          result = handleTimeline(settings, body.guestId);
          break;
        }

        case 'updateEvent': {
          verifyAdmin(settings, adminPin);
          result = handleUpdateEvent(settings, body);
          break;
        }

        case 'endEvent': {
          verifyAdmin(settings, adminPin);
          result = handleEndEvent(settings);
          break;
        }

        default:
          throw { status: 400, error: 'unknown_action', message: `Unknown action: ${action}` };
      }
    } finally {
      if (lock) {
        try { lock.releaseLock(); } catch (_) {}
      }
    }

    const jsonStr = JSON.stringify(result);
    if (requestId) {
      try {
        CacheService.getScriptCache().put('idem:' + requestId, jsonStr, 21600); // 6 hours
      } catch (_) {}
    }

    return ContentService.createTextOutput(jsonStr)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    const errorPayload = {
      error: err.error || err.code || 'internal_error',
      message: err.message || String(err),
      status: err.status || 500,
    };
    return ContentService.createTextOutput(JSON.stringify(errorPayload))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
