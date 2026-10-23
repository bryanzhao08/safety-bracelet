import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';
import { createJobs } from '../server/jobs.js';
import { parseCsv } from '../server/imports.js';

async function fixture(dbFile = ':memory:') {
  const db = openDb(dbFile);
  let time = Date.parse('2026-10-21T22:00:00Z');
  let closed = false;
  const server = createServer({ db, now: () => new Date(time), startJobs: false });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, base,
    now: () => new Date(time),
    setTime: x => { time = typeof x === 'number' ? x : Date.parse(x); },
    advanceTime: ms => { time += ms; },
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise(ok => server.close(ok));
      db.close();
    },
    request: async (method, path, { body, headers = {}, redirect } = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect,
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = raw; }
      return { status: response.status, data, headers: response.headers, raw };
    },
  };
}

async function setupEvent(f, count = 35) {
  const created = await f.request('POST', '/api/events', {
    body: { name: 'Meet Party', startsAt: '2026-10-21T20:00:00Z', endsAt: '2026-10-22T04:00:00Z' },
  });
  assert.equal(created.status, 201, created.raw);
  const { eventId, adminPin, monitorCode } = created.data;
  const admin = { 'X-Admin-Pin': adminPin };
  const made = await f.request('POST', `/api/events/${eventId}/bands`, { headers: admin, body: { count } });
  assert.equal(made.status, 200, made.raw);
  const session = await f.request('POST', `/api/events/${eventId}/monitor-session`, { body: { monitorCode, name: 'Door' } });
  assert.equal(session.status, 200, session.raw);
  return {
    eventId,
    admin,
    monitor: { Authorization: `Bearer ${session.data.monitorToken}` },
    bands: made.data.bands,
    session,
  };
}

test('guest meetups: happy path, audit, idempotency', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 5);

  const maya = (await f.request('POST', `/api/events/${s.eventId}/guests`, {
    headers: s.admin, body: { name: 'Maya Chen', email: 'maya@example.test', phone: '555-0101' },
  })).data.guest;
  const jordan = (await f.request('POST', `/api/events/${s.eventId}/guests`, {
    headers: s.admin, body: { name: 'Jordan Kim', email: 'jordan@example.test', phone: '555-0102' },
  })).data.guest;

  // Scan Maya in
  await f.request('POST', '/api/scan', {
    headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: maya.id },
  });
  // Link Jordan to band 1 (does not have to be inside)
  await f.request('POST', '/api/scan', {
    headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: jordan.id },
  });
  await f.request('POST', '/api/scan', {
    headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'out' },
  });

  // Maya taps Jordan's band
  const meet = await f.request('POST', '/api/meet', {
    headers: { 'Idempotency-Key': 'meet-key-1' },
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(meet.status, 200, meet.raw);
  assert.equal(meet.data.ok, true);
  assert.equal(meet.data.with.firstName, 'Jordan');
  assert.ok(meet.data.at);

  // Check audit row
  const auditRows = f.db.prepare("SELECT * FROM audit WHERE eventId=? AND action='guest_meet'").all(s.eventId);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].actor, 'guest');
  assert.deepEqual(JSON.parse(auditRows[0].detail), {
    bandA: s.bands[0].shortCode,
    bandB: s.bands[1].shortCode,
  });

  // Idempotency replay returns exact same response without creating new interactions
  const replay = await f.request('POST', '/api/meet', {
    headers: { 'Idempotency-Key': 'meet-key-1' },
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(replay.status, 200, replay.raw);
  assert.deepEqual(replay.data, meet.data);
  const totalInteractions = f.db.prepare('SELECT COUNT(*) n FROM interactions WHERE eventId=?').get(s.eventId).n;
  assert.equal(totalInteractions, 1);
});

test('guest meetups: not_inside and self-meet rejections', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 5);

  const g1 = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Alex A' } })).data.guest;
  const g2 = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Blake B' } })).data.guest;

  // Self meet
  const self = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[0].token },
  });
  assert.equal(self.status, 400);
  assert.equal(self.data.error, 'self_meet');

  // Neither band linked or inside
  const unlinked = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(unlinked.status, 409);
  assert.equal(unlinked.data.error, 'not_inside');

  // Link both bands, but tapper is not inside
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: g1.id } });
  f.advanceTime(1000);
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'out' } });
  f.advanceTime(1000);
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: g2.id } });

  // Band 0 is OUT, tries to tap Band 1
  const tapperOut = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(tapperOut.status, 409);
  assert.equal(tapperOut.data.error, 'not_inside');

  // Band from a completely different event
  const otherEvent = await setupEvent(f, 2);
  const diffEvent = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[1].token, theirBandToken: otherEvent.bands[0].token },
  });
  assert.equal(diffEvent.status, 409);
  assert.equal(diffEvent.data.error, 'not_inside');

  // Non-existent band token
  const badToken = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[1].token, theirBandToken: 'invalid_token_123' },
  });
  assert.equal(badToken.status, 409);
  assert.equal(badToken.data.error, 'not_inside');
});

test('guest meetups: 5-minute dedupe returns existing row', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 5);

  const maya = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Maya Chen' } })).data.guest;
  const jordan = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Jordan Kim' } })).data.guest;

  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: maya.id } });
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: jordan.id } });

  // First tap at T
  const meet1 = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(meet1.status, 200);
  assert.equal(meet1.data.with.firstName, 'Jordan');
  const t1 = meet1.data.at;

  // Advance clock by 2 minutes (< 5 min)
  f.advanceTime(2 * 60_000);

  // Maya taps Jordan again: returns existing row with timestamp t1
  const meet2 = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(meet2.status, 200);
  assert.equal(meet2.data.at, t1);
  assert.equal(meet2.data.with.firstName, 'Jordan');

  // Reverse pair: Jordan taps Maya at 3 minutes (< 5 min)
  f.advanceTime(60_000);
  const meet3 = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[1].token, theirBandToken: s.bands[0].token },
  });
  assert.equal(meet3.status, 200);
  assert.equal(meet3.data.at, t1);
  assert.equal(meet3.data.with.firstName, 'Maya');

  // Verify only 1 row in database so far
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interactions WHERE eventId=?').get(s.eventId).n, 1);

  // Advance past 5 minutes (now at 6 minutes from t1)
  f.advanceTime(3 * 60_000);
  const meet4 = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(meet4.status, 200);
  assert.notEqual(meet4.data.at, t1);
  assert.equal(meet4.data.with.firstName, 'Jordan');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interactions WHERE eventId=?').get(s.eventId).n, 2);
});

test('guest meetups: rate limit of 30 per band per hour', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 35);

  const mainGuest = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Main Tapper' } })).data.guest;
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: mainGuest.id } });

  // Link 32 other guests
  for (let i = 1; i <= 32; i++) {
    const g = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: `Guest ${i}` } })).data.guest;
    await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[i].token, direction: 'in', guestId: g.id } });
  }

  // 30 successful meets within 1 hour
  for (let i = 1; i <= 30; i++) {
    const res = await f.request('POST', '/api/meet', {
      body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[i].token },
    });
    assert.equal(res.status, 200, `meet ${i} failed: ${res.raw}`);
  }

  // 31st meet from the same band within the hour hits 429
  const limited = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[31].token },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error, 'rate_limited');

  // After 1 hour, rate limit resets
  f.advanceTime(3_600_000 + 1000);
  const afterHour = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[31].token },
  });
  assert.equal(afterHour.status, 200);
});

test('guest meetups: first-name-only response privacy invariant', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 3);

  const tapper = (await f.request('POST', `/api/events/${s.eventId}/guests`, {
    headers: s.admin, body: { name: 'Sammy Davis', email: 'sammy@private.test', phone: '555-1111' },
  })).data.guest;
  const tapped = (await f.request('POST', `/api/events/${s.eventId}/guests`, {
    headers: s.admin, body: { name: 'Priya Sharma-Patel', email: 'priya@private.test', phone: '555-2222' },
  })).data.guest;

  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: tapper.id } });
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: tapped.id } });

  const meet = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(meet.status, 200);
  assert.deepEqual(Object.keys(meet.data).sort(), ['at', 'ok', 'with']);
  assert.deepEqual(meet.data.with, { firstName: 'Priya' });

  // Strict privacy check: body must never contain surname, email, phone, or internal guestId
  for (const privateData of ['Sharma', 'Patel', 'priya@private.test', '555-2222', tapped.id, 'sammy@private.test', '555-1111', tapper.id]) {
    assert.equal(meet.raw.includes(privateData), false, `Response leaked private datum: ${privateData}`);
  }
});

test('guest meetups: timeline, export csv, and dashboard roster count', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 3);

  const maya = (await f.request('POST', `/api/events/${s.eventId}/guests`, {
    headers: s.admin, body: { name: 'Maya Chen', email: 'maya@example.test', phone: '415-555-0101' },
  })).data.guest;
  const jess = (await f.request('POST', `/api/events/${s.eventId}/guests`, {
    headers: s.admin, body: { name: 'Jess Miller', email: 'jess@example.test', phone: '415-555-0102' },
  })).data.guest;

  f.setTime('2026-10-21T23:00:00Z');
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: maya.id } });
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: jess.id } });

  // Maya meets Jess at 23:10 (11:10 pm)
  f.setTime('2026-10-21T23:10:00Z');
  const meet = await f.request('POST', '/api/meet', {
    body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token },
  });
  assert.equal(meet.status, 200);

  // Check Timeline for Maya
  const mayaTimeline = await f.request('GET', `/api/events/${s.eventId}/guests/${maya.id}/timeline`, { headers: s.admin });
  assert.equal(mayaTimeline.status, 200);
  const mayaMetEvent = mayaTimeline.data.events.find(e => e.type === 'met');
  assert.ok(mayaMetEvent, 'Maya timeline should contain met event');
  assert.equal(mayaMetEvent.detail.with, 'Jess Miller');
  assert.equal(mayaMetEvent.at, '2026-10-21T23:10:00.000Z');

  // Check Timeline for Jess
  const jessTimeline = await f.request('GET', `/api/events/${s.eventId}/guests/${jess.id}/timeline`, { headers: s.admin });
  assert.equal(jessTimeline.status, 200);
  const jessMetEvent = jessTimeline.data.events.find(e => e.type === 'met');
  assert.ok(jessMetEvent, 'Jess timeline should contain met event');
  assert.equal(jessMetEvent.detail.with, 'Maya Chen');
  assert.equal(jessMetEvent.at, '2026-10-21T23:10:00.000Z');

  // Check Dashboard Roster
  const dash = await f.request('GET', '/api/dashboard', { headers: s.monitor });
  assert.equal(dash.status, 200);
  const mayaRoster = dash.data.roster.find(r => r.name === 'Maya Chen');
  const jessRoster = dash.data.roster.find(r => r.name === 'Jess Miller');
  assert.equal(mayaRoster.meetups, 1);
  assert.equal(jessRoster.meetups, 1);

  // Check Export CSV
  const exported = await f.request('GET', `/api/events/${s.eventId}/export.csv`, { headers: s.admin });
  assert.equal(exported.status, 200);
  const rows = parseCsv(exported.raw);
  assert.equal(rows[0][7], 'met');
  const mayaRow = rows.find(r => r[0] === 'Maya Chen');
  const jessRow = rows.find(r => r[0] === 'Jess Miller');
  assert.equal(mayaRow[7], 'Jess Miller 11:10 pm');
  assert.equal(jessRow[7], 'Maya Chen 11:10 pm');
});

test('guest meetups: retention clears interactions', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 3);

  const maya = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Maya Chen' } })).data.guest;
  const jess = (await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Jess Miller' } })).data.guest;

  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: maya.id } });
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: jess.id } });
  await f.request('POST', '/api/meet', { body: { myBandToken: s.bands[0].token, theirBandToken: s.bands[1].token } });

  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interactions WHERE eventId=?').get(s.eventId).n, 1);

  // Fast forward past retention days (event ends 2026-10-22T04:00:00Z + 30 days = 2026-11-21T04:00:00Z)
  f.setTime('2026-11-22T00:00:00Z');
  createJobs({ db: f.db, now: f.now }).runRetention();

  // All interactions, guests, bands, scans, etc. deleted
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interactions').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM guests').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bands').get().n, 0);
});

test('guest meetups: /t/:bandToken serves web/t/index.html with token metadata', async t => {
  const f = await fixture();
  t.after(f.close);
  const s = await setupEvent(f, 2);

  // Public tap without monitor session
  const tapRes = await f.request('GET', `/t/${s.bands[0].token}`);
  assert.equal(tapRes.status, 200);
  assert.match(tapRes.raw, /Homebound safety band/);
  assert.match(tapRes.raw, new RegExp(`data-band-token="${s.bands[0].token}"`));
  assert.match(tapRes.raw, new RegExp(`<meta name="band-token" content="${s.bands[0].token}">`));
  assert.match(tapRes.raw, new RegExp(`id="hb-band-token">${JSON.stringify(s.bands[0].token)}`));

  // With monitor session cookie -> redirects 302 to /door?bandToken=...
  const cookie = s.session.headers.get('set-cookie').split(';')[0];
  const monitorTap = await f.request('GET', `/t/${s.bands[0].token}`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  assert.equal(monitorTap.status, 302);
  assert.match(monitorTap.headers.get('location'), new RegExp(`/door\\?bandToken=${s.bands[0].token}`));
});
