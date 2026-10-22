import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Open a database and install the pilot schema. */
export function openDb(path = 'data/homebound.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      org TEXT NOT NULL,
      startsAt TEXT NOT NULL,
      endsAt TEXT NOT NULL,
      capacity INTEGER,
      adminPinHash TEXT NOT NULL,
      monitorCode TEXT NOT NULL,
      retentionHours INTEGER NOT NULL DEFAULT 48,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bands (
      token TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      shortCode TEXT NOT NULL,
      deviceId TEXT,
      displayName TEXT,
      createdAt TEXT NOT NULL,
      UNIQUE(eventId, shortCode)
    );

    CREATE TABLE IF NOT EXISTS presence (
      id TEXT PRIMARY KEY,
      bandToken TEXT NOT NULL,
      eventId TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
      at TEXT NOT NULL,
      by TEXT NOT NULL CHECK(by IN ('monitor', 'guest'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS circles (
      token TEXT PRIMARY KEY,
      deviceId TEXT NOT NULL,
      eventId TEXT NOT NULL,
      label TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS circle_members (
      id TEXT PRIMARY KEY,
      circleToken TEXT NOT NULL,
      nickname TEXT,
      pushSubscription TEXT,
      joinedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departures (
      id TEXT PRIMARY KEY,
      bandToken TEXT NOT NULL,
      eventId TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      leftAt TEXT NOT NULL,
      leavingWith TEXT,
      destination TEXT NOT NULL CHECK(destination IN ('home', 'friend', 'other')),
      expectedHomeAt TEXT NOT NULL,
      sharedWith TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'home', 'alerted', 'cancelled')),
      homeAt TEXT,
      reminderAt TEXT,
      nudgeAt TEXT
    );

    CREATE TABLE IF NOT EXISTS help_requests (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      bandShortCode TEXT,
      note TEXT,
      location TEXT,
      createdAt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open', 'ack', 'resolved')),
      ackBy TEXT,
      resolvedAt TEXT,
      resolution TEXT
    );

    CREATE TABLE IF NOT EXISTS guest_push (
      deviceId TEXT PRIMARY KEY,
      subscription TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incident_holds (
      deviceId TEXT NOT NULL,
      eventId TEXT NOT NULL,
      until TEXT NOT NULL,
      PRIMARY KEY(deviceId, eventId)
    );

    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      at TEXT NOT NULL,
      detail TEXT
    );

    CREATE TABLE IF NOT EXISTS monitor_sessions (
      token TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_deliveries (
      departureId TEXT NOT NULL,
      stage TEXT NOT NULL,
      sentAt TEXT NOT NULL,
      PRIMARY KEY(departureId, stage)
    );

    CREATE INDEX IF NOT EXISTS bands_event_idx ON bands(eventId);
    CREATE INDEX IF NOT EXISTS bands_device_idx ON bands(deviceId, eventId);
    CREATE INDEX IF NOT EXISTS presence_band_at_idx ON presence(bandToken, at DESC);
    CREATE INDEX IF NOT EXISTS presence_event_at_idx ON presence(eventId, at DESC);
    CREATE INDEX IF NOT EXISTS circles_device_event_idx ON circles(deviceId, eventId);
    CREATE INDEX IF NOT EXISTS circle_members_circle_idx ON circle_members(circleToken);
    CREATE INDEX IF NOT EXISTS departures_device_event_idx ON departures(deviceId, eventId);
    CREATE INDEX IF NOT EXISTS departures_event_idx ON departures(eventId);
    CREATE INDEX IF NOT EXISTS departures_status_due_idx ON departures(status, expectedHomeAt);
    CREATE INDEX IF NOT EXISTS help_event_status_idx ON help_requests(eventId, status);
    CREATE INDEX IF NOT EXISTS monitor_sessions_event_idx ON monitor_sessions(eventId);
    CREATE INDEX IF NOT EXISTS audit_event_at_idx ON audit(eventId, at DESC);
  `);
  return db;
}
