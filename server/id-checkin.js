import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';

export function serverSecret(file = join(process.env.HB_DATA_DIR || 'data', 'secret.json')) {
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    mkdirSync(dirname(file), { recursive: true });
    try { writeFileSync(file, JSON.stringify({ key: randomBytes(32).toString('hex') }) + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; }
    saved = JSON.parse(readFileSync(file, 'utf8'));
  }
  if (!/^[0-9a-f]{64}$/.test(saved.key)) throw new Error('Invalid ID secret');
  return Buffer.from(saved.key, 'hex');
}

export function licenseHash(eventId, state, licenseNumber, secretFile) {
  const canonicalState = state.trim().toUpperCase();
  const canonicalNumber = licenseNumber.trim().toUpperCase().replace(/\s+/g, '');
  return createHmac('sha256', serverSecret(secretFile)).update(eventId + canonicalState + canonicalNumber).digest('hex');
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function ageAndExpiry(dob, idExpires, eventStartsAt) {
  const eventDate = eventStartsAt.slice(0, 10);
  const twentyFirst = `${Number(dob.slice(0, 4)) + 21}${dob.slice(4)}`;
  return { over21: eventDate >= twentyFirst, expired: idExpires < eventDate };
}

const normalize = value => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const parts = name => {
  const reordered = name.includes(',') ? name.split(',').reverse().join(' ') : name;
  const words = normalize(reordered).split(' ').filter(Boolean);
  return { first: words[0] || '', last: words.at(-1) || '' };
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

export function matchGuests(guests, firstName, lastName) {
  const target = parts(`${firstName} ${lastName}`);
  const exact = guests.filter(g => { const p = parts(g.name); return p.first === target.first && p.last === target.last; });
  if (exact.length) return exact;
  return guests.filter(g => {
    const p = parts(g.name);
    return p.first && p.last && distanceAtMostOne(p.first, target.first) && distanceAtMostOne(p.last, target.last);
  });
}
