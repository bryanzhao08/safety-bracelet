import { utf8ToBase64Url, base64UrlToUtf8 } from './b64.js';

const B32_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function newId() {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += B32_ALPHABET[bytes[i] % 32];
  }
  return id;
}

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const SOCIAL_RE = /^[A-Za-z0-9._]{1,30}$/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SCRIPT_RE = /[<>]|javascript:/i;

function validateAndCleanCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('bad_card');
  }

  // Reject oversized raw payload (e.g. hostile extra data)
  try {
    const rawLen = JSON.stringify(raw).length;
    if (rawLen > 2000) {
      throw new Error('bad_card');
    }
  } catch {
    throw new Error('bad_card');
  }

  if (raw.v !== undefined && raw.v !== 1) {
    throw new Error('bad_card');
  }

  if (typeof raw.id !== 'string') {
    throw new Error('bad_card');
  }
  const id = raw.id.trim();
  if (id.length < 1 || id.length > 50 || SCRIPT_RE.test(id)) {
    throw new Error('bad_card');
  }

  if (typeof raw.n !== 'string') {
    throw new Error('bad_card');
  }
  const n = raw.n.trim();
  if (n.length < 1 || n.length > 40 || SCRIPT_RE.test(n)) {
    throw new Error('bad_card');
  }

  const clean = {
    v: 1,
    id,
    n
  };

  if (raw.p !== undefined && raw.p !== null) {
    if (typeof raw.p !== 'string') throw new Error('bad_card');
    const p = raw.p.trim();
    if (p.length > 0) {
      if (!PHONE_RE.test(p) || SCRIPT_RE.test(p)) throw new Error('bad_card');
      clean.p = p;
    }
  }

  if (raw.ig !== undefined && raw.ig !== null) {
    if (typeof raw.ig !== 'string') throw new Error('bad_card');
    let ig = raw.ig.trim();
    if (ig.startsWith('@')) ig = ig.slice(1);
    if (ig.length > 0) {
      if (!SOCIAL_RE.test(ig) || SCRIPT_RE.test(ig)) throw new Error('bad_card');
      clean.ig = ig;
    }
  }

  if (raw.sc !== undefined && raw.sc !== null) {
    if (typeof raw.sc !== 'string') throw new Error('bad_card');
    let sc = raw.sc.trim();
    if (sc.startsWith('@')) sc = sc.slice(1);
    if (sc.length > 0) {
      if (!SOCIAL_RE.test(sc) || SCRIPT_RE.test(sc)) throw new Error('bad_card');
      clean.sc = sc;
    }
  }

  if (raw.e !== undefined && raw.e !== null) {
    if (typeof raw.e !== 'string') throw new Error('bad_card');
    const e = raw.e.trim();
    if (e.length > 0) {
      if (!EMAIL_RE.test(e) || SCRIPT_RE.test(e)) throw new Error('bad_card');
      clean.e = e;
    }
  }

  return clean;
}

export function encodeCard(card) {
  const clean = validateAndCleanCard(card);
  return utf8ToBase64Url(JSON.stringify(clean));
}

export function decodeCard(str) {
  if (typeof str !== 'string' || !str.trim()) {
    throw new Error('bad_card');
  }
  let json;
  try {
    json = base64UrlToUtf8(str.trim());
  } catch {
    // If str was already raw json, try that as fallback
    if (str.trim().startsWith('{')) {
      json = str.trim();
    } else {
      throw new Error('bad_card');
    }
  }
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('bad_card');
  }
  return validateAndCleanCard(obj);
}

export function cardUrl(base, card) {
  const encoded = encodeCard(card);
  if (base.endsWith('#add=')) {
    return `${base}${encoded}`;
  }
  if (base.includes('#add=')) {
    return base.replace(/#add=.*$/, `#add=${encoded}`);
  }
  return `${base}#add=${encoded}`;
}

export function parseScan(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }
  const trimmed = text.trim();
  let candidate = trimmed;
  const match = trimmed.match(/#add=([^&]+)/);
  if (match) {
    candidate = match[1];
  } else if (trimmed.startsWith('#add=')) {
    candidate = trimmed.slice(5);
  }
  try {
    return decodeCard(candidate);
  } catch {
    return null;
  }
}

export function vcard(card) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${card.n}`,
    `N:${card.n};;;;`
  ];
  if (card.p) {
    lines.push(`TEL;TYPE=CELL:${card.p}`);
    lines.push(`TEL:${card.p}`);
  }
  if (card.e) {
    lines.push(`EMAIL:${card.e}`);
  }
  if (card.ig) {
    lines.push(`X-SOCIALPROFILE;type=instagram:https://instagram.com/${card.ig}`);
  }
  if (card.sc) {
    lines.push(`X-SOCIALPROFILE;type=snapchat:https://snapchat.com/add/${card.sc}`);
  }
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}
