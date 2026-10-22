import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';

test('monitor POST idempotency survives a restart and offline scan time is bounded', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'hb-reliability-'));
  const dbFile = path.join(folder, 'homebound.sqlite');
  let clock = Date.parse('2026-10-22T22:00:00Z');
  let db, server, base;
  const start = async () => {
    db = openDb(dbFile); server = createServer({ db, now: () => new Date(clock), startJobs: false, idSecretPath: path.join(folder, 'secret.json') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => { await new Promise(resolve => server.close(resolve)); db.close(); };
  const request = async (method, route, body, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  await start();
  try {
    const created = await request('POST', '/api/events', { name: 'Pilot Event', startsAt: '2026-10-22T20:00:00Z', endsAt: '2026-10-23T03:00:00Z' });
    const { eventId, adminPin, monitorCode } = created.data;
    const admin = { 'X-Admin-Pin': adminPin };
    const bands = (await request('POST', `/api/events/${eventId}/bands`, { count: 2 }, admin)).data.bands;
    const sessionBody = { monitorCode, name: 'Door' }, sessionKey = { 'Idempotency-Key': 'session-1' };
    const session = await request('POST', `/api/events/${eventId}/monitor-session`, sessionBody, sessionKey);
    const sessionAgain = await request('POST', `/api/events/${eventId}/monitor-session`, sessionBody, sessionKey);
    assert.deepEqual(sessionAgain.data, session.data); assert.match(sessionAgain.cookie, /hb_monitor=/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM monitor_sessions').get().n, 1);
    const monitor = { Authorization: `Bearer ${session.data.monitorToken}` };
    const guestRoute = `/api/events/${eventId}/guests`;
    const guest = await request('POST', guestRoute, { name: 'Maya Lee' }, { ...monitor, 'Idempotency-Key': 'guest-1' });
    assert.deepEqual((await request('POST', guestRoute, { name: 'Changed' }, { ...monitor, 'Idempotency-Key': 'guest-1' })).data, guest.data);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM guests').get().n, 1);
    const licenseNumber = 'RELIABILITY-LICENSE-79348';
    const idBody = { firstName: 'Maya', lastName: 'Lee', dob: '1998-03-12', idState: 'CA', idExpires: '2028-03-12', licenseNumber };
    const check = await request('POST', '/api/id-checkin', idBody, { ...monitor, 'Idempotency-Key': licenseNumber });
    assert.equal(check.status, 200);
    assert.deepEqual((await request('POST', '/api/id-checkin', idBody, { ...monitor, 'Idempotency-Key': licenseNumber })).data, check.data);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit WHERE action=\'id_checkin\'').get().n, 1);
    const offlineAt = new Date(clock - 3_600_000).toISOString();
    const scanBody = { bandToken: bands[0].token, direction: 'in', guestId: guest.data.guest.id, at: offlineAt };
    const scan = await request('POST', '/api/scan', scanBody, { ...monitor, 'Idempotency-Key': 'scan-1' });
    assert.equal(scan.status, 200); assert.equal(scan.data.at, offlineAt);
    assert.equal((await request('POST', '/api/scan', { ...scanBody, direction: 'out' }, { ...monitor, 'Idempotency-Key': 'scan-1' })).data.at, offlineAt);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM scans').get().n, 1);
    assert.equal((await request('POST', '/api/scan', { bandToken: bands[1].token, direction: 'in', guestId: guest.data.guest.id, at: new Date(clock - 13 * 3_600_000).toISOString() }, monitor)).status, 400);
    assert.equal((await request('POST', '/api/scan', scanBody, { ...monitor, 'Idempotency-Key': 'x'.repeat(65) })).status, 400);
    await stop(); await start();
    const replay = await request('POST', '/api/scan', scanBody, { ...monitor, 'Idempotency-Key': 'scan-1' });
    assert.deepEqual(replay.data, scan.data);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM scans').get().n, 1);
    assert.equal(readFileSync(dbFile).includes(Buffer.from(licenseNumber)), false);
    const depBody = { bandTokens: [bands[0].token] };
    const dep = await request('POST', '/api/departures', depBody, { ...monitor, 'Idempotency-Key': 'departure-1' });
    assert.equal(dep.status, 200);
    assert.deepEqual((await request('POST', '/api/departures', depBody, { ...monitor, 'Idempotency-Key': 'departure-1' })).data, dep.data);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM departures').get().n, 1);
    clock += 49 * 3_600_000;
    const renewed = await request('POST', guestRoute, { name: 'After expiry' }, { ...monitor, 'Idempotency-Key': 'guest-1' });
    assert.notDeepEqual(renewed.data, guest.data);
  } finally { await stop(); rmSync(folder, { recursive: true, force: true }); }
});

test('capacity PATCH and public pilot signup with owner-only listing and IP rate limit', async () => {
  const oldToken = process.env.HB_OWNER_TOKEN;
  process.env.HB_OWNER_TOKEN = 'owner-test-token';
  const db = openDb(':memory:');
  const server = createServer({ db, startJobs: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, body, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const created = (await request('POST', '/api/events', { name: 'Original', startsAt: '2026-10-22T20:00:00Z', endsAt: '2026-10-23T03:00:00Z' })).data;
    const route = `/api/events/${created.eventId}`;
    assert.equal((await request('PATCH', route, { capacity: 150 })).status, 403);
    assert.equal((await request('PATCH', route, { capacity: 0 }, { 'X-Admin-Pin': created.adminPin })).status, 400);
    const updated = await request('PATCH', route, { capacity: 150, name: 'Updated' }, { 'X-Admin-Pin': created.adminPin });
    assert.equal(updated.status, 200); assert.equal(updated.data.event.capacity, 150); assert.equal(updated.data.event.name, 'Updated');
    const monitorToken = (await request('POST', `${route}/monitor-session`, { monitorCode: created.monitorCode, name: 'Door' })).data.monitorToken;
    const dashboard = await request('GET', '/api/dashboard', undefined, { Authorization: `Bearer ${monitorToken}` });
    assert.equal(dashboard.data.event.capacity, 150);
    assert.equal((await request('GET', '/api/pilot')).status, 403);
    assert.equal((await request('GET', '/api/pilot', undefined, { 'X-Owner-Token': 'wrong' })).status, 403);
    assert.equal((await request('POST', '/api/pilot', { chapter: '', school: 'A', email: 'bad' })).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await request('POST', '/api/pilot', { chapter: `Chapter ${i}`, school: 'State U', email: `c${i}@example.test`, eventSize: 200, note: 'Fall party' })).status, 201);
    assert.equal((await request('POST', '/api/pilot', { chapter: 'Sixth', school: 'State U', email: 'sixth@example.test' })).status, 429);
    const listed = await request('GET', '/api/pilot', undefined, { 'X-Owner-Token': 'owner-test-token' });
    assert.equal(listed.status, 200); assert.equal(listed.data.length, 5);
    assert.equal(listed.data[0].eventSize, 200);
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close();
    if (oldToken === undefined) delete process.env.HB_OWNER_TOKEN; else process.env.HB_OWNER_TOKEN = oldToken;
  }
});
