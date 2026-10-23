import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDb(file = process.env.HB_DB || 'data/homebound-v2.sqlite') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, startsAt TEXT NOT NULL, endsAt TEXT NOT NULL,
      adminPinHash TEXT NOT NULL, monitorCode TEXT NOT NULL, retentionDays INTEGER NOT NULL DEFAULT 30,
      lumaEventId TEXT, lumaApiKeyEnc TEXT, createdAt TEXT NOT NULL, capacity INTEGER
    );
    CREATE TABLE IF NOT EXISTS guests (
      id TEXT PRIMARY KEY, eventId TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT,
      source TEXT NOT NULL CHECK(source IN ('luma','partiful','manual','id')),
      externalId TEXT, createdAt TEXT NOT NULL, dob TEXT, over21 INTEGER, idState TEXT,
      idExpires TEXT, idHash TEXT, idScannedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS guests_external ON guests(eventId, source, externalId) WHERE externalId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS guests_event_name ON guests(eventId, name);
    CREATE INDEX IF NOT EXISTS guests_event_email ON guests(eventId, email);
    CREATE TABLE IF NOT EXISTS bands (
      token TEXT PRIMARY KEY, eventId TEXT NOT NULL, shortCode TEXT NOT NULL,
      guestId TEXT, createdAt TEXT NOT NULL, UNIQUE(eventId, shortCode)
    );
    CREATE INDEX IF NOT EXISTS bands_event_guest ON bands(eventId, guestId);
    CREATE UNIQUE INDEX IF NOT EXISTS bands_one_per_guest ON bands(eventId, guestId) WHERE guestId IS NOT NULL;
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY, eventId TEXT NOT NULL, bandToken TEXT NOT NULL, guestId TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('in','out')), at TEXT NOT NULL, monitorName TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scans_band_time ON scans(bandToken, at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS scans_event ON scans(eventId, at);
    CREATE TABLE IF NOT EXISTS departures (
      id TEXT PRIMARY KEY, eventId TEXT NOT NULL, groupId TEXT NOT NULL, guestId TEXT,
      bandToken TEXT NOT NULL, at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS departures_event_group ON departures(eventId, groupId);
    CREATE INDEX IF NOT EXISTS departures_band_time ON departures(bandToken, at DESC);
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, eventId TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
      at TEXT NOT NULL, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_event_at ON audit(eventId, at DESC);
    CREATE TABLE IF NOT EXISTS monitor_sessions (
      token TEXT PRIMARY KEY, eventId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS monitor_sessions_event ON monitor_sessions(eventId);
    CREATE TABLE IF NOT EXISTS idempotency (
      eventId TEXT NOT NULL, route TEXT NOT NULL, key TEXT NOT NULL,
      status INTEGER NOT NULL, response TEXT NOT NULL, createdAt TEXT NOT NULL,
      PRIMARY KEY(eventId, route, key)
    );
    CREATE INDEX IF NOT EXISTS idempotency_created ON idempotency(createdAt);
    CREATE TABLE IF NOT EXISTS pilot_signups (
      id TEXT PRIMARY KEY, chapter TEXT NOT NULL, school TEXT NOT NULL, email TEXT NOT NULL,
      eventSize INTEGER, note TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY, eventId TEXT NOT NULL, bandA TEXT NOT NULL, bandB TEXT NOT NULL,
      guestA TEXT, guestB TEXT, at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'guest_tap'
    );
    CREATE INDEX IF NOT EXISTS interactions_event_banda ON interactions(eventId, bandA);
    CREATE INDEX IF NOT EXISTS interactions_event_bandb ON interactions(eventId, bandB);
  `);
  const eventColumns = new Set(db.prepare('PRAGMA table_info(events)').all().map(row => row.name));
  if (!eventColumns.has('capacity')) db.exec('ALTER TABLE events ADD COLUMN capacity INTEGER');
  const columns = new Set(db.prepare('PRAGMA table_info(guests)').all().map(row => row.name));
  const guestSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='guests'").get().sql;
  if (!columns.has('idHash') || !guestSchema.includes("'id'")) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE guests_new (
        id TEXT PRIMARY KEY, eventId TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT,
        source TEXT NOT NULL CHECK(source IN ('luma','partiful','manual','id')),
        externalId TEXT, createdAt TEXT NOT NULL, dob TEXT, over21 INTEGER, idState TEXT,
        idExpires TEXT, idHash TEXT, idScannedAt TEXT
      );
      INSERT INTO guests_new (id,eventId,name,email,phone,source,externalId,createdAt)
        SELECT id,eventId,name,email,phone,source,externalId,createdAt FROM guests;
      DROP TABLE guests;
      ALTER TABLE guests_new RENAME TO guests;
      CREATE UNIQUE INDEX guests_external ON guests(eventId, source, externalId) WHERE externalId IS NOT NULL;
      CREATE INDEX guests_event_name ON guests(eventId, name);
      CREATE INDEX guests_event_email ON guests(eventId, email);
      COMMIT;
    `);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS guests_event_idhash ON guests(eventId, idHash) WHERE idHash IS NOT NULL');
  return db;
}
