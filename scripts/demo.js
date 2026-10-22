import { randomInt } from 'node:crypto';
import { openDb } from '../server/db.js';
import { hashPin, randomToken, shortCode } from '../server/tokens.js';

const db = openDb();
const now = new Date(), createdAt = now.toISOString();
const eventId = randomToken(), adminPin = String(randomInt(100_000_000)).padStart(8, '0');
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const monitorCode = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
const base = (process.env.BASE_URL || 'http://localhost:4400').replace(/\/$/, '');
const names = ['Alex', 'Bailey', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jordan'];
const insertGuest = db.prepare('INSERT INTO guests (id,eventId,name,email,phone,source,createdAt) VALUES (?,?,?,?,?,?,?)');
const insertBand = db.prepare('INSERT INTO bands (token,eventId,shortCode,createdAt) VALUES (?,?,?,?)');

db.exec('BEGIN IMMEDIATE');
try {
  db.prepare('INSERT INTO events (id,name,startsAt,endsAt,adminPinHash,monitorCode,createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(eventId, 'Homebound Demo', createdAt, new Date(now.getTime() + 5 * 3_600_000).toISOString(), hashPin(adminPin), monitorCode, createdAt);
  const sample = [];
  for (let i = 0; i < 40; i++) {
    insertGuest.run(randomToken(), eventId, `${names[i % names.length]} ${String(i + 1).padStart(2, '0')}`, `guest${i + 1}@example.test`, null, 'partiful', createdAt);
    const token = randomToken(); let code;
    do { code = shortCode(); } while (db.prepare('SELECT 1 FROM bands WHERE eventId=? AND shortCode=?').get(eventId, code));
    insertBand.run(token, eventId, code, createdAt);
    if (sample.length < 3) sample.push(`${code}: ${base}/t/${token}`);
  }
  db.exec('COMMIT');
  console.log(`Event ID: ${eventId}\nAdmin PIN: ${adminPin}\nMonitor code: ${monitorCode}\nBand URLs:\n${sample.join('\n')}`);
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
