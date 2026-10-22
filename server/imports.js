import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const LUMA_URL = 'https://public-api.lu.ma/public/v1/event/get-guests';

export function parseCsv(text) {
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
const header = s => clean(s).replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function csvGuests(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('CSV is empty');
  const names = rows.shift().map(header);
  const find = (...options) => names.findIndex(n => options.includes(n));
  const nameCol = find('name', 'fullname', 'guestname', 'attendeename', 'guestfullname');
  const firstCol = find('firstname', 'guestfirstname', 'first');
  const lastCol = find('lastname', 'guestlastname', 'last');
  const emailCol = find('email', 'emailaddress', 'guestemail', 'attendeeemail');
  const phoneCol = find('phone', 'phonenumber', 'mobile', 'guestphone', 'mobilenumber');
  if (nameCol < 0 && firstCol < 0) throw new Error('CSV needs a name column');
  return rows.map(row => ({
    name: clean(nameCol >= 0 ? row[nameCol] : `${row[firstCol] ?? ''} ${row[lastCol] ?? ''}`),
    email: emailCol < 0 ? null : clean(row[emailCol]) || null,
    phone: phoneCol < 0 ? null : clean(row[phoneCol]) || null,
  }));
}

export function csvEscape(value) {
  const s = String(value ?? '');
  // Prefix spreadsheet formulas so exported guest data cannot execute in Excel/Sheets.
  const safe = /^[\s]*[=+@-]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function secret() {
  const configured = process.env.HOMEBOUND_SECRET;
  if (configured) return createHash('sha256').update(configured).digest();
  const file = 'data/server-secret';
  try { return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    mkdirSync('data', { recursive: true });
    const generated = randomBytes(32);
    try { writeFileSync(file, generated.toString('hex'), { mode: 0o600, flag: 'wx' }); return generated; }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex'); }
  }
}

export function encryptApiKey(apiKey) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret(), nonce);
  const body = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), body].map(x => x.toString('base64url')).join('.');
}

export async function fetchLumaGuests({ apiKey, lumaEventId, fetcher = fetch }) {
  const guests = [];
  const seen = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const url = new URL(LUMA_URL);
    url.searchParams.set('event_api_id', lumaEventId);
    url.searchParams.set('pagination_limit', '50');
    if (cursor) url.searchParams.set('pagination_cursor', cursor);
    const response = await fetcher(url, { headers: { 'x-luma-api-key': apiKey, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Luma returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.entries)) throw new Error('Unexpected Luma response');
    for (const entry of data.entries) {
      const guest = entry.guest ?? entry;
      const status = guest.approval_status ?? entry.approval_status;
      if (status !== 'approved') continue;
      const user = guest.user ?? entry.user ?? {};
      const name = clean(guest.name ?? guest.full_name ?? user.name ?? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`);
      if (!name) continue;
      guests.push({ name, email: clean(guest.email ?? user.email) || null,
        phone: clean(guest.phone_number ?? guest.phone ?? user.phone_number) || null,
        externalId: clean(guest.api_id ?? guest.id ?? entry.api_id) || null });
    }
    if (!data.has_more) return guests;
    cursor = data.next_cursor;
    if (!cursor || seen.has(cursor)) throw new Error('Invalid Luma pagination');
    seen.add(cursor);
  }
  throw new Error('Luma pagination limit exceeded');
}
