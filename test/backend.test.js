import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';
import { createJobs } from '../server/jobs.js';

const openFixtures = new Set();
after(async () => {
  for (const f of openFixtures) await f.close();
});

async function fixture() {
  const db = openDb(':memory:');
  let clock = Date.parse('2026-10-21T22:00:00.000Z');
  const notifications = [];
  const now = () => new Date(clock);
  const notify = async (target, message) => { notifications.push({ target, message }); };
  const server = createServer({ db, now, notify, startJobs: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const f = {
    db, server, base, notifications, now,
    advance(ms) { clock += ms; },
    setTime(iso) { clock = Date.parse(iso); },
    async close() {
      if (!openFixtures.delete(f)) return;
      await new Promise(resolve => server.close(resolve));
      db.close();
    },
    async request(method, path, { body, headers = {}, cookie, raw = false } = {}) {
      const h = { ...headers };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      if (cookie) h.Cookie = cookie;
      const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers, text, res: raw ? res : undefined };
    },
  };
  openFixtures.add(f);
  return f;
}

async function setup(f, count = 2) {
  const created = await f.request('POST', '/api/events', { body: {
    name: 'Autumn Party', org: 'Homebound', startsAt: '2026-10-21T20:00:00.000Z',
    endsAt: '2026-10-22T03:00:00.000Z', capacity: 100,
  } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { eventId, adminPin, monitorCode } = created.data;
  const admin = { 'X-Admin-Pin': adminPin };
  const made = await f.request('POST', `/api/events/${eventId}/bands`, { headers: admin, body: { count } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const session = await f.request('POST', `/api/events/${eventId}/monitor-session`, { body: { monitorCode, name: 'Door' } });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const monitor = { Authorization: `Bearer ${session.data.monitorToken}` };
  return { eventId, adminPin, monitorCode, admin, monitor, bands: made.data.bands };
}

async function link(f, token, cookie) {
  const r = await f.request('GET', `/api/bands/${token}`, { cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const setCookie = r.headers.get('set-cookie');
  return { data: r.data, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

function assertPrivate(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  for (const key of ['leavingWith', 'destination', 'circleToken', 'circle_members', 'deviceId', 'deviceToken', 'sharedWith']) {
    assert.equal(json.includes(`"${key}"`), false, `${key} leaked: ${json}`);
  }
}

test('organizer and monitor endpoints, scan flow, help lifecycle and privacy', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  assert.match(s.adminPin, /^\d{8}$/);
  assert.match(s.monitorCode, /^[A-Z0-9]{6}$/);
  assert.equal(s.bands.length, 2);
  assert.match(s.bands[0].shortCode, /^[A-Z0-9]{4}$/);
  assert.ok(s.bands[0].url.includes(s.bands[0].token));

  const event = await f.request('GET', `/api/events/${s.eventId}`, { headers: s.admin });
  assert.equal(event.status, 200);
  assert.equal(event.data.stats.bands, 2);
  assertPrivate(event.data);
  const csv = await f.request('GET', `/api/events/${s.eventId}/bands.csv`, { headers: s.admin });
  assert.equal(csv.status, 200);
  assert.match(csv.text, /shortCode,url/);
  assert.match(csv.text, new RegExp(s.bands[0].shortCode));

  const inScan = await f.request('POST', '/api/door/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in' } });
  assert.equal(inScan.status, 200, JSON.stringify(inScan.data));
  assert.equal(inScan.data.inside, true);
  assertPrivate(inScan.data);
  const again = await f.request('POST', '/api/door/scan', { headers: s.monitor, body: { shortCode: s.bands[0].shortCode, direction: 'in' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.warning, 'already_inside');
  const state = await f.request('GET', '/api/monitor/state', { headers: s.monitor });
  assert.equal(state.status, 200);
  assert.equal(state.data.inside, 1);
  assert.equal(state.data.insideBands[0].shortCode, s.bands[0].shortCode);
  assertPrivate(state.data);

  const help = await f.request('POST', '/api/help', { body: { eventId: s.eventId, note: 'Need help', location: 'East door' } });
  assert.equal(help.status, 201, JSON.stringify(help.data));
  assert.ok(help.data.id);
  const stateWithHelp = await f.request('GET', '/api/monitor/state', { headers: s.monitor });
  assert.equal(stateWithHelp.data.help.length, 1);
  assertPrivate(stateWithHelp.data);
  const ack = await f.request('POST', `/api/monitor/help/${help.data.id}/ack`, { headers: s.monitor });
  assert.equal(ack.status, 200, JSON.stringify(ack.data));
  const resolve = await f.request('POST', `/api/monitor/help/${help.data.id}/resolve`, { headers: s.monitor, body: { resolution: 'Friend found' } });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.data));
  const incidents = await f.request('GET', `/api/events/${s.eventId}/incidents`, { headers: s.admin });
  assert.equal(incidents.status, 200);
  assertPrivate(incidents.data);

  const outScan = await f.request('POST', '/api/door/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'toggle' } });
  assert.equal(outScan.status, 200);
  assert.equal(outScan.data.inside, false);
  const ended = await f.request('POST', `/api/events/${s.eventId}/end`, { headers: s.admin });
  assert.equal(ended.status, 200);
  assertPrivate(ended.data);
});

test('guest, circle and departure endpoints enforce ownership and sharing', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const guest = await link(f, s.bands[0].token);
  assert.equal(guest.data.mine, true);
  assert.equal(guest.data.band.shortCode, s.bands[0].shortCode);
  assert.match(guest.cookie, /^hb_device=/);
  const other = await link(f, s.bands[1].token);
  assert.notEqual(guest.cookie, other.cookie);
  const denied = await f.request('PUT', `/api/bands/${s.bands[0].token}/name`, { cookie: other.cookie, body: { displayName: 'Intruder' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error, 'band_linked_elsewhere');
  const renamed = await f.request('PUT', `/api/bands/${s.bands[0].token}/name`, { cookie: guest.cookie, body: { displayName: 'Maya' } });
  assert.equal(renamed.status, 200);
  const circleA = await f.request('POST', '/api/circles', { cookie: guest.cookie, body: { eventId: s.eventId, label: 'Roommates' } });
  const circleB = await f.request('POST', '/api/circles', { cookie: guest.cookie, body: { eventId: s.eventId, label: 'Family' } });
  assert.equal(circleA.status, 201, JSON.stringify(circleA.data));
  assert.equal(circleB.status, 201, JSON.stringify(circleB.data));
  assert.ok(circleA.data.inviteUrl.includes(circleA.data.circleToken));
  const joined = await f.request('POST', `/api/circles/${circleA.data.circleToken}/join`, { body: { nickname: 'Jo' } });
  assert.equal(joined.status, 201, JSON.stringify(joined.data));
  const push = await f.request('POST', '/api/push/guest', { cookie: guest.cookie, body: { subscription: { endpoint: 'https://example.test/push', keys: { auth: 'a', p256dh: 'b' } } } });
  assert.equal(push.status, 200, JSON.stringify(push.data));
  const inScan = await f.request('POST', '/api/door/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in' } });
  assert.equal(inScan.status, 200);

  const dep = await f.request('POST', '/api/departures', { cookie: guest.cookie, body: {
    bandToken: s.bands[0].token, leavingWith: 'Jordan', destination: 'home',
    expectedHomeAt: '2026-10-21T22:30:00.000Z', sharedWith: [circleA.data.circleToken],
  } });
  assert.equal(dep.status, 201, JSON.stringify(dep.data));
  assert.equal(dep.data.departure.leavingWith, 'Jordan');
  const id = dep.data.departure.id;
  assert.ok(id);
  const aView = await f.request('GET', `/api/circles/${circleA.data.circleToken}`);
  const bView = await f.request('GET', `/api/circles/${circleB.data.circleToken}`);
  assert.equal(aView.status, 200);
  assert.equal(aView.data.departures.length, 1);
  assert.equal(aView.data.departures[0].leavingWith, 'Jordan');
  assert.equal(bView.status, 200);
  assert.equal(bView.data.departures.length, 0);
  const admin = await f.request('GET', `/api/events/${s.eventId}`, { headers: s.admin });
  const monitor = await f.request('GET', '/api/monitor/state', { headers: s.monitor });
  assertPrivate(admin.data);
  assertPrivate(monitor.data);
  const wrongHome = await f.request('POST', `/api/departures/${id}/home`, { cookie: other.cookie });
  assert.equal(wrongHome.status, 403);
  const home = await f.request('POST', `/api/departures/${id}/home`, { cookie: guest.cookie });
  assert.equal(home.status, 200, JSON.stringify(home.data));
  assert.equal((await f.request('GET', `/api/circles/${circleA.data.circleToken}`)).data.departures[0].status, 'home');

  const exp = await f.request('GET', '/api/me/export', { cookie: guest.cookie });
  assert.equal(exp.status, 200);
  assert.match(JSON.stringify(exp.data), /Jordan/);
  const hold = await f.request('POST', '/api/holds', { cookie: guest.cookie, body: { eventId: s.eventId } });
  assert.equal(hold.status, 200, JSON.stringify(hold.data));
  const deleted = await f.request('DELETE', `/api/circles/${circleB.data.circleToken}`, { cookie: guest.cookie });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));

  const second = await f.request('POST', '/api/departures', { cookie: guest.cookie, body: {
    bandToken: s.bands[0].token, destination: 'friend', expectedHomeAt: '2026-10-21T23:00:00.000Z',
    sharedWith: [circleA.data.circleToken],
  } });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  const cancelled = await f.request('POST', `/api/departures/${second.data.departure.id}/cancel`, { cookie: guest.cookie });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
});

test('auth failures and input limits return JSON errors', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const checks = [
    ['GET', `/api/events/${s.eventId}`, {}],
    ['POST', `/api/events/${s.eventId}/bands`, { body: { count: 1 } }],
    ['GET', `/api/events/${s.eventId}/bands.csv`, {}],
    ['GET', `/api/events/${s.eventId}/incidents`, {}],
    ['POST', `/api/events/${s.eventId}/end`, {}],
    ['GET', '/api/monitor/state', {}],
    ['POST', '/api/door/scan', { body: { bandToken: s.bands[0].token, direction: 'in' } }],
    ['POST', '/api/monitor/help/1/ack', {}],
    ['POST', '/api/monitor/help/1/resolve', { body: { resolution: 'done' } }],
    ['POST', '/api/departures', { body: { bandToken: s.bands[0].token, destination: 'home', expectedHomeAt: '2026-10-21T23:00:00Z' } }],
    ['POST', '/api/holds', { body: { eventId: s.eventId } }],
    ['GET', '/api/me/export', {}],
  ];
  for (const [method, path, options] of checks) {
    const r = await f.request(method, path, options);
    assert.ok([401, 403].includes(r.status), `${method} ${path}: ${r.status} ${r.text}`);
    assert.equal(typeof r.data.error, 'string');
    assert.equal(typeof r.data.message, 'string');
  }
  const badSession = await f.request('POST', `/api/events/${s.eventId}/monitor-session`, { body: { monitorCode: 'WRONG!', name: 'Eve' } });
  assert.ok([401, 403].includes(badSession.status));
  const tooMany = await f.request('POST', `/api/events/${s.eventId}/bands`, { headers: s.admin, body: { count: 2001 } });
  assert.equal(tooMany.status, 400);
  const guest = await link(f, s.bands[0].token);
  const longName = await f.request('PUT', `/api/bands/${s.bands[0].token}/name`, { cookie: guest.cookie, body: { displayName: 'x'.repeat(25) } });
  assert.equal(longName.status, 400);
  const foreign = await f.request('PUT', `/api/bands/${s.bands[0].token}/name`, { cookie: 'hb_device=foreign', body: { displayName: 'Eve' } });
  assert.equal(foreign.status, 401);
});

test('alert timeline uses injectable clock and stops after home', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const guest = await link(f, s.bands[0].token);
  const circle = await f.request('POST', '/api/circles', { cookie: guest.cookie, body: { eventId: s.eventId, label: 'Friends' } });
  assert.equal(circle.status, 201);
  await f.request('POST', `/api/circles/${circle.data.circleToken}/join`, { body: { nickname: 'Jo', subscription: { endpoint: 'https://example.test/circle', keys: { auth: 'a', p256dh: 'b' } } } });
  const dep = await f.request('POST', '/api/departures', { cookie: guest.cookie, body: {
    bandToken: s.bands[0].token, destination: 'home', expectedHomeAt: '2026-10-21T22:01:00.000Z',
    sharedWith: [circle.data.circleToken],
  } });
  assert.equal(dep.status, 201);
  f.notifications.length = 0;
  const jobs = createJobs({ db: f.db, now: f.now, notify: async (target, message) => { f.notifications.push({ target, message }); } });
  await jobs.runAlerts();
  assert.equal(f.notifications.length, 0);
  f.advance(60_000);
  await jobs.runAlerts();
  assert.equal(f.notifications.filter(n => n.target.type === 'guest').length, 1);
  await jobs.runAlerts();
  assert.equal(f.notifications.filter(n => n.target.type === 'guest').length, 1);
  f.advance(10 * 60_000);
  await jobs.runAlerts();
  assert.equal(f.notifications.filter(n => n.target.type === 'guest').length, 2);
  f.advance(10 * 60_000);
  await jobs.runAlerts();
  assert.equal(f.notifications.filter(n => n.target.type === 'circle').length, 1);
  const alerted = await f.request('GET', `/api/circles/${circle.data.circleToken}`);
  assert.equal(alerted.data.departures[0].status, 'alerted');
  await jobs.runAlerts();
  assert.equal(f.notifications.filter(n => n.target.type === 'circle').length, 1);
  const home = await f.request('POST', `/api/departures/${dep.data.departure.id}/home`, { cookie: guest.cookie });
  assert.equal(home.status, 200);
  f.advance(60 * 60_000);
  await jobs.runAlerts();
  assert.equal(f.notifications.filter(n => n.target.type === 'guest').length, 2);
});

test('retention removes event data, anonymizes help and preserves only held guest departures', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const held = await link(f, s.bands[0].token);
  const ordinary = await link(f, s.bands[1].token);
  const hCircle = await f.request('POST', '/api/circles', { cookie: held.cookie, body: { eventId: s.eventId, label: 'Held circle' } });
  const oCircle = await f.request('POST', '/api/circles', { cookie: ordinary.cookie, body: { eventId: s.eventId, label: 'Ordinary circle' } });
  assert.equal(hCircle.status, 201); assert.equal(oCircle.status, 201);
  await f.request('POST', `/api/circles/${hCircle.data.circleToken}/join`, { body: { nickname: 'H' } });
  await f.request('POST', `/api/circles/${oCircle.data.circleToken}/join`, { body: { nickname: 'O' } });
  for (const [band, cookie, circle] of [[s.bands[0], held.cookie, hCircle], [s.bands[1], ordinary.cookie, oCircle]]) {
    await f.request('POST', '/api/door/scan', { headers: s.monitor, body: { bandToken: band.token, direction: 'in' } });
    const d = await f.request('POST', '/api/departures', { cookie, body: { bandToken: band.token, destination: 'home', expectedHomeAt: '2026-10-21T22:30:00Z', sharedWith: [circle.data.circleToken] } });
    assert.equal(d.status, 201, JSON.stringify(d.data));
  }
  await f.request('POST', '/api/help', { body: { eventId: s.eventId, bandToken: s.bands[0].token, note: 'Help', location: 'Hall' } });
  assert.equal((await f.request('POST', '/api/holds', { cookie: held.cookie, body: { eventId: s.eventId } })).status, 200);
  const jobs = createJobs({ db: f.db, now: f.now, notify: async () => {} });
  f.setTime('2026-10-24T03:00:01.000Z');
  await jobs.runRetention();
  const count = table => f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  assert.equal(count('presence'), 0);
  assert.equal(count('circles'), 0);
  assert.equal(count('circle_members'), 0);
  assert.equal(count('guest_push'), 0);
  assert.equal(count('departures'), 1);
  assert.equal(f.db.prepare('SELECT bandToken FROM departures').get().bandToken, s.bands[0].token);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM bands WHERE deviceId IS NOT NULL OR displayName IS NOT NULL').get().n, 0);
  const help = f.db.prepare('SELECT bandShortCode FROM help_requests WHERE eventId = ?').get(s.eventId);
  assert.equal(help.bandShortCode, null);
  assert.equal((await f.request('GET', `/api/events/${s.eventId}/incidents`, { headers: s.admin })).status, 200);
});

test('door scan stays under 50 ms with 2,000 bands', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f, 2000);
  const band = s.bands[1999];
  const start = process.hrtime.bigint();
  const scan = await f.request('POST', '/api/door/scan', { headers: s.monitor, body: { bandToken: band.token, direction: 'in' } });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(scan.status, 200, JSON.stringify(scan.data));
  assert.ok(elapsedMs < 50, `door scan took ${elapsedMs.toFixed(1)} ms with 2,000 bands`);
});

test('SSE requires monitor token and emits private scan and help events', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const unauthorized = await f.request('GET', '/api/monitor/stream');
  assert.equal(unauthorized.status, 401);
  const token = s.monitor.Authorization.slice('Bearer '.length);
  const controller = new AbortController();
  const response = await fetch(`${f.base}/api/monitor/stream?token=${encodeURIComponent(token)}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  t.after(() => { controller.abort(); reader.cancel().catch(() => {}); });
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /connected/);
  const scan = await f.request('POST', '/api/door/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in' } });
  assert.equal(scan.status, 200);
  let received = '';
  for (let i = 0; i < 3 && !received.includes('event: scan'); i++) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE event timed out')), 3000)),
    ]);
    received += new TextDecoder().decode(chunk.value);
  }
  assert.match(received, /event: scan/);
  assertPrivate(received);
  const help = await f.request('POST', '/api/help', { body: { eventId: s.eventId, note: 'Need a monitor' } });
  assert.equal(help.status, 201);
  let helpEvent = '';
  for (let i = 0; i < 3 && !helpEvent.includes('event: help'); i++) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE help timed out')), 3000)),
    ]);
    helpEvent += new TextDecoder().decode(chunk.value);
  }
  assert.match(helpEvent, /event: help/);
  assertPrivate(helpEvent);
  controller.abort();
});

test('API and static responses carry security headers', async t => {
  const f = await fixture(); t.after(() => f.close());
  const api = await f.request('GET', '/api/missing');
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  const staticResponse = await f.request('GET', '/shared/missing.css');
  assert.equal(staticResponse.status, 404);
  assert.match(staticResponse.headers.get('content-security-policy'), /default-src 'self'/);
});

test('help is limited to three requests per device in ten minutes', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const guest = await link(f, s.bands[0].token);
  for (let i = 0; i < 3; i++) {
    const r = await f.request('POST', '/api/help', { cookie: guest.cookie, body: { eventId: s.eventId, bandToken: s.bands[0].token, note: `Help ${i}` } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const limited = await f.request('POST', '/api/help', { cookie: guest.cookie, body: { eventId: s.eventId } });
  assert.equal(limited.status, 429);
  f.advance(10 * 60_000);
  const reset = await f.request('POST', '/api/help', { cookie: guest.cookie, body: { eventId: s.eventId } });
  assert.equal(reset.status, 201);
});

test('home and cancel transitions are idempotent and notify circles once', async t => {
  const f = await fixture(); t.after(() => f.close());
  const s = await setup(f);
  const guest = await link(f, s.bands[0].token);
  const circle = await f.request('POST', '/api/circles', { cookie: guest.cookie, body: { eventId: s.eventId, label: 'Friends' } });
  assert.equal(circle.status, 201);
  const createDeparture = async () => {
    const r = await f.request('POST', '/api/departures', { cookie: guest.cookie, body: {
      bandToken: s.bands[0].token, destination: 'home', expectedHomeAt: '2026-10-21T23:30:00.000Z',
      sharedWith: [circle.data.circleToken],
    } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.departure.id;
  };
  const first = await createDeparture();
  const beforeHome = f.notifications.length;
  const home = await f.request('POST', `/api/departures/${first}/home`, { cookie: guest.cookie });
  assert.equal(home.status, 200);
  assert.equal(home.data.departure.status, 'home');
  assert.equal(f.notifications.length, beforeHome + 1);
  const repeatHome = await f.request('POST', `/api/departures/${first}/home`, { cookie: guest.cookie });
  assert.equal(repeatHome.status, 200);
  assert.equal(repeatHome.data.departure.status, 'home');
  assert.equal(f.notifications.length, beforeHome + 1);
  const cancelHome = await f.request('POST', `/api/departures/${first}/cancel`, { cookie: guest.cookie });
  assert.equal(cancelHome.status, 409);
  assert.equal(cancelHome.data.error, 'departure_closed');
  const second = await createDeparture();
  const cancel = await f.request('POST', `/api/departures/${second}/cancel`, { cookie: guest.cookie });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.departure.status, 'cancelled');
  const beforeInvalidHome = f.notifications.length;
  const homeCancelled = await f.request('POST', `/api/departures/${second}/home`, { cookie: guest.cookie });
  assert.equal(homeCancelled.status, 409);
  assert.equal(homeCancelled.data.error, 'departure_closed');
  assert.equal(f.notifications.length, beforeInvalidHome);
});
