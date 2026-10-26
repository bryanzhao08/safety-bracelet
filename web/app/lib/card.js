import { utf8ToBase64Url, base64UrlToUtf8 } from './b64.js';
import { decodeParty } from './party.js';

const B32_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SCRIPT_RE = /[<>]|javascript:/i;
const SOCIAL = {
  ig: /^[A-Za-z0-9._]{1,30}$/, sc: /^[A-Za-z][A-Za-z0-9._-]{2,14}$/,
  tt: /^[A-Za-z0-9._]{2,24}$/, x: /^[A-Za-z0-9_]{1,15}$/,
  li: /^[A-Za-z0-9-]{3,100}$/
};
const URL_BASE = {
  ig: 'https://instagram.com/', sc: 'https://snapchat.com/add/',
  tt: 'https://www.tiktok.com/@', x: 'https://x.com/', li: 'https://www.linkedin.com/in/'
};
const LABEL = { ig: 'instagram', sc: 'snapchat', tt: 'tiktok', x: 'twitter', li: 'linkedin' };

export const PLATFORMS = [
  { key: 'ig', label: 'Instagram', placeholder: '@username', shareHelp: 'Profile → Share profile → Copy link' },
  { key: 'sc', label: 'Snapchat', placeholder: '@username', shareHelp: 'Profile → Share profile → Copy link' },
  { key: 'tt', label: 'TikTok', placeholder: '@username', shareHelp: 'Profile → Share profile → Copy link' },
  { key: 'x', label: 'X', placeholder: '@username', shareHelp: 'Profile → Share profile → Copy link' },
  { key: 'li', label: 'LinkedIn', placeholder: 'profile-name', shareHelp: 'Profile → More → Share profile → Copy link' }
];

export function newId() {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(b => B32_ALPHABET[b % 32]).join('');
}

function validateAndCleanCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad_card');
  let json;
  try { json = JSON.stringify(raw); } catch { throw new Error('bad_card'); }
  if (!json || new TextEncoder().encode(json).length > 2000 || (raw.v !== undefined && raw.v !== 1)) throw new Error('bad_card');
  if (typeof raw.id !== 'string' || typeof raw.n !== 'string') throw new Error('bad_card');
  const id = raw.id.trim();
  const n = raw.n.trim();
  if (!id || id.length > 50 || SCRIPT_RE.test(id) || !n || n.length > 40 || SCRIPT_RE.test(n)) throw new Error('bad_card');
  const clean = { v: 1, id, n };
  for (const [key, re] of [['p', PHONE_RE], ['e', EMAIL_RE], ...Object.entries(SOCIAL)]) {
    if (raw[key] == null) continue;
    if (typeof raw[key] !== 'string') throw new Error('bad_card');
    let value = raw[key].trim();
    if (SOCIAL[key] && value.startsWith('@')) value = value.slice(1);
    if (value) {
      if (!re.test(value) || SCRIPT_RE.test(value)) throw new Error('bad_card');
      clean[key] = value;
    }
  }
  return clean;
}

export function encodeCard(card) { return utf8ToBase64Url(JSON.stringify(validateAndCleanCard(card))); }
export function decodeCard(str) {
  if (typeof str !== 'string' || !str.trim()) throw new Error('bad_card');
  let json;
  try { json = base64UrlToUtf8(str.trim()); }
  catch { if (str.trim().startsWith('{')) json = str.trim(); else throw new Error('bad_card'); }
  try { return validateAndCleanCard(JSON.parse(json)); } catch { throw new Error('bad_card'); }
}
export function cardUrl(base, card) {
  const encoded = encodeCard(card);
  if (base.endsWith('#add=')) return base + encoded;
  if (base.includes('#add=')) return base.replace(/#add=.*$/, `#add=${encoded}`);
  return `${base.split('#')[0]}#add=${encoded}`;
}

export function parseProfileLink(text) {
  if (typeof text !== 'string') return null;
  const input = text.trim();
  if (/^@[A-Za-z0-9._-]+$/.test(input)) return { platform: null, handle: input.slice(1) };
  if (!/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|snapchat\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com)\//i.test(input)) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let platform, handle;
  if (host === 'instagram.com' && parts.length === 1) [platform, handle] = ['ig', parts[0]];
  else if (host === 'snapchat.com' && parts.length === 2 && parts[0].toLowerCase() === 'add') [platform, handle] = ['sc', parts[1]];
  else if (host === 'tiktok.com' && parts.length === 1 && parts[0].startsWith('@')) [platform, handle] = ['tt', parts[0].slice(1)];
  else if ((host === 'x.com' || host === 'twitter.com') && parts.length === 1) [platform, handle] = ['x', parts[0]];
  else if (host === 'linkedin.com' && parts.length === 2 && parts[0].toLowerCase() === 'in') [platform, handle] = ['li', parts[1]];
  return platform && SOCIAL[platform].test(handle) ? { platform, handle } : null;
}

export function profileUrl(key, handle) {
  if (!SOCIAL[key] || typeof handle !== 'string') throw new Error('bad_platform');
  const clean = handle.trim().replace(/^@/, '');
  if (!SOCIAL[key].test(clean)) throw new Error('bad_handle');
  return URL_BASE[key] + clean;
}

export function shareableCard(me, share = {}) {
  const card = validateAndCleanCard(me);
  const result = { v: 1, id: card.id, n: card.n };
  for (const key of ['p', 'e', ...Object.keys(SOCIAL)]) {
    if (card[key] !== undefined && share?.[key] !== false) result[key] = card[key];
  }
  return result;
}

export function parseScan(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim();
  const partyMatch = trimmed.match(/#party=([^&]+)/);
  const cardMatch = trimmed.match(/#add=([^&]+)/);
  try {
    if (partyMatch) return { kind: 'party', party: decodeParty(partyMatch[1]) };
    if (cardMatch) return { kind: 'card', card: decodeCard(cardMatch[1]) };
    return { kind: 'card', card: decodeCard(trimmed) };
  } catch { return null; }
}

function escapeVcard(value) { return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
export function vcard(card) {
  const c = validateAndCleanCard(card);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVcard(c.n)}`, `N:${escapeVcard(c.n)};;;;`];
  if (c.p) lines.push(`TEL;TYPE=CELL:${c.p}`, `TEL:${c.p}`);
  if (c.e) lines.push(`EMAIL:${c.e}`);
  for (const key of Object.keys(SOCIAL)) {
    if (c[key]) lines.push(`X-SOCIALPROFILE;type=${LABEL[key]}:${profileUrl(key, c[key])}`, `URL:${profileUrl(key, c[key])}`);
  }
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}
