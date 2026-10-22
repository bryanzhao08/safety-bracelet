import { randomInt } from 'node:crypto';
import { openDb } from '../server/db.js';
import { hashPin, randomToken, shortCode } from '../server/tokens.js';

const db = openDb();
const now = new Date();
const startsAt = now.toISOString();
const endsAt = new Date(now.getTime() + 5 * 60 * 60_000).toISOString();
const eventId = randomToken();
const adminPin = String(randomInt(0, 100_000_000)).padStart(8, '0');
const monitorAlphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const monitorCode = Array.from({ length: 6 }, () => monitorAlphabet[randomInt(monitorAlphabet.length)]).join('');
const baseUrl = (process.env.BASE_URL || 'http://localhost:4400').replace(/\/$/, '');

db.prepare(`INSERT INTO events
  (id, name, org, startsAt, endsAt, capacity, adminPinHash, monitorCode, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(eventId, 'Homebound Demo', 'Demo chapter', startsAt, endsAt, 100,
    hashPin(adminPin), monitorCode, startsAt);

const insertBand = db.prepare(`INSERT INTO bands
  (token, eventId, shortCode, createdAt) VALUES (?, ?, ?, ?)`);
const sample = [];
for (let i = 0; i < 30; i++) {
  const token = randomToken();
  let code;
  do {
    code = shortCode();
  } while (db.prepare('SELECT 1 FROM bands WHERE eventId = ? AND shortCode = ?').get(eventId, code));
  insertBand.run(token, eventId, code, startsAt);
  if (sample.length < 3) sample.push(`${code}: ${baseUrl}/b/${token}`);
}

console.log(`Event ID: ${eventId}`);
console.log(`Admin PIN: ${adminPin}`);
console.log(`Monitor code: ${monitorCode}`);
console.log(`Band URLs:\n${sample.join('\n')}`);
db.close();
