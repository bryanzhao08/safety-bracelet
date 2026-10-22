import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';

test('admin timeline shows incident sequence and latest companions, audits lookup, and omits license data', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'homebound-timeline-'));
  const db = openDb(':memory:'); let clock = Date.parse('2026-10-21T21:00:00Z');
  const server = createServer({ db, now: () => new Date(clock), startJobs: false, idSecretPath: path.join(folder, 'secret.json') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, { body, headers = {} } = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, data, raw };
  };
  try {
    const created = await request('POST', '/api/events', { body: { name: 'Party', startsAt: '2026-10-21T20:00:00Z', endsAt: '2026-10-22T03:00:00Z' } });
    const { eventId, adminPin, monitorCode } = created.data;
    const admin = { 'X-Admin-Pin': adminPin };
    const bands = (await request('POST', `/api/events/${eventId}/bands`, { headers: admin, body: { count: 2 } })).data.bands;
    const monitorToken = (await request('POST', `/api/events/${eventId}/monitor-session`, { body: { monitorCode, name: 'Door' } })).data.monitorToken;
    const monitor = { Authorization: `Bearer ${monitorToken}` };
    const maya = (await request('POST', `/api/events/${eventId}/guests`, { headers: admin, body: { name: 'Maya Lee', email: 'maya@example.test', phone: '415-555-0101' } })).data.guest;
    const jordan = (await request('POST', `/api/events/${eventId}/guests`, { headers: admin, body: { name: 'Jordan Kim', phone: '415-555-0102' } })).data.guest;
    const licenseNumber = 'TIMELINE-LICENSE-72904';
    const checked = await request('POST', '/api/id-checkin', { headers: monitor, body: {
      firstName: 'Maya', lastName: 'Lee', dob: '1999-01-02', idState: 'CA', idExpires: '2028-01-01', licenseNumber,
    } });
    assert.equal(checked.status, 200, checked.raw);
    clock += 60_000;
    const firstIn = new Date(clock).toISOString();
    for (const [band, guest] of [[bands[0], maya], [bands[1], jordan]]) {
      assert.equal((await request('POST', '/api/scan', { headers: monitor, body: { bandToken: band.token, direction: 'in', guestId: guest.id } })).status, 200);
    }
    clock += 60_000;
    assert.equal((await request('POST', '/api/departures', { headers: monitor, body: { bandTokens: bands.map(band => band.token) } })).status, 200);
    const route = `/api/events/${eventId}/guests/${maya.id}/timeline`;
    assert.equal((await request('GET', route, { headers: monitor })).status, 403);
    assert.equal((await request('GET', route)).status, 403);
    const timeline = await request('GET', route, { headers: admin });
    assert.equal(timeline.status, 200, timeline.raw);
    assert.deepEqual(timeline.data.guest, { name: 'Maya Lee', email: 'maya@example.test', phone: '415-555-0101', over21: true, idState: 'CA' });
    assert.deepEqual(timeline.data.band, { shortCode: bands[0].shortCode });
    assert.deepEqual(timeline.data.events.map(item => item.type), ['id_check', 'in', 'out', 'departure']);
    assert.equal(timeline.data.lastSeenInsideAt, firstIn);
    assert.deepEqual(timeline.data.leftWith, [{ name: 'Jordan Kim', phone: '415-555-0102' }]);
    assert.deepEqual(timeline.data.events.at(-1).detail.leftWith, ['Jordan Kim']);
    for (const privateValue of [licenseNumber, '1999-01-02', '2028-01-01', 'idHash', 'licenseNumber']) assert.equal(timeline.raw.includes(privateValue), false);
    const audit = db.prepare("SELECT actor,action,detail FROM audit WHERE action='guest_timeline_lookup'").all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor, 'organizer');
    assert.deepEqual(JSON.parse(audit[0].detail), { guestId: maya.id });
    const missing = await request('GET', `/api/events/${eventId}/guests/unknown/timeline`, { headers: admin });
    assert.equal(missing.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close(); rmSync(folder, { recursive: true, force: true });
  }
});
