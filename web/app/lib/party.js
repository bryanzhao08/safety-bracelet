import { utf8ToBase64Url, base64UrlToUtf8 } from './b64.js';

const unsafe = /[<>]|javascript:/i;
const phone = /^\+?[0-9 ()-]{7,20}$/;
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const bad = () => { throw new Error('bad_party'); };

function field(value, max, min = 1) {
  if (typeof value !== 'string') bad();
  const s = value.trim();
  if (s.length < min || s.length > max || unsafe.test(s)) bad();
  return s;
}

function cleanParty(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad();
  let json;
  try { json = JSON.stringify(raw); } catch { bad(); }
  if (!json || new TextEncoder().encode(json).length > 1536 || raw.v !== 1) bad();
  const id = field(raw.id, 50);
  const name = field(raw.name, 60);
  if (!iso.test(raw.startsAt) || !iso.test(raw.endsAt)) bad();
  const start = Date.parse(raw.startsAt);
  const end = Date.parse(raw.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) bad();
  if (!raw.host || typeof raw.host !== 'object' || Array.isArray(raw.host)) bad();
  const host = { n: field(raw.host.n, 40) };
  if (raw.host.p != null && raw.host.p !== '') {
    host.p = field(raw.host.p, 20, 7);
    if (!phone.test(host.p)) bad();
  }
  const party = { v: 1, id, name, startsAt: raw.startsAt, endsAt: raw.endsAt, host };
  if (raw.ride != null && raw.ride !== '') party.ride = field(raw.ride, 140);
  if (raw.note != null && raw.note !== '') party.note = field(raw.note, 280);
  if (raw.ask !== undefined) {
    if (!raw.ask || typeof raw.ask !== 'object' || Array.isArray(raw.ask) || raw.ask.home !== true) bad();
    party.ask = { home: true };
  }
  return party;
}

export function encodeParty(party) {
  return utf8ToBase64Url(JSON.stringify(cleanParty(party)));
}

export function decodeParty(encoded) {
  if (typeof encoded !== 'string' || !encoded.trim()) bad();
  let json;
  try { json = base64UrlToUtf8(encoded.trim()); }
  catch { if (encoded.trim().startsWith('{')) json = encoded.trim(); else bad(); }
  try { return cleanParty(JSON.parse(json)); } catch { bad(); }
}

export function partyUrl(base, party) {
  const encoded = encodeParty(party);
  if (base.endsWith('#party=')) return base + encoded;
  if (base.includes('#party=')) return base.replace(/#party=.*$/, `#party=${encoded}`);
  return `${base.split('#')[0]}#party=${encoded}`;
}
