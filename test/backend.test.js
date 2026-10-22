import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';
import { createJobs } from '../server/jobs.js';
import { parseCsv } from '../server/imports.js';

async function fixture(fetcher) {
  const db = openDb(':memory:'); let time = Date.parse('2026-10-21T22:00:00Z');
  const server = createServer({ db, now: () => new Date(time), fetcher, startJobs: false });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, base, now: () => new Date(time), setTime: x => { time = Date.parse(x); },
    close: async () => { await new Promise(ok => server.close(ok)); db.close(); },
    request: async (method, path, { body, headers = {}, csv = false, redirect } = {}) => {
      const response = await fetch(base + path, { method, headers: { ...(body !== undefined && !csv ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : csv ? body : JSON.stringify(body), redirect });
      const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = raw; }
      return { status: response.status, data, headers: response.headers, raw };
    },
  };
}
async function setup(f, count = 2) {
  const created = await f.request('POST', '/api/events', { body: { name: 'Autumn Party', startsAt: '2026-10-21T20:00:00Z', endsAt: '2026-10-22T03:00:00Z' } });
  assert.equal(created.status, 201, created.raw);
  const { eventId, adminPin, monitorCode } = created.data;
  const admin = { 'X-Admin-Pin': adminPin };
  const made = await f.request('POST', `/api/events/${eventId}/bands`, { headers: admin, body: { count } });
  assert.equal(made.status, 200, made.raw);
  const session = await f.request('POST', `/api/events/${eventId}/monitor-session`, { body: { monitorCode, name: 'Door' } });
  assert.equal(session.status, 200, session.raw);
  return { eventId, admin, monitor: { Authorization: `Bearer ${session.data.monitorToken}` }, bands: made.data.bands, session };
}
const q = (f, sql, ...args) => f.db.prepare(sql).get(...args);

function monitorPrivate(value) {
  const json = JSON.stringify(value);
  for (const word of ['email', 'phone', '@example.test']) assert.equal(json.includes(word), false, json);
}

test('v2 event, CSV import, scan, dashboard, export and privacy', async t => {
  const f = await fixture(); t.after(f.close); const s = await setup(f);
  assert.match(s.bands[0].url, /\/t\/[0-9a-f]{32}$/);
  assert.match(s.session.data.monitorToken, /^[0-9a-f]{32}$/);
  const csvText = 'Full Name,Email Address,Phone Number\r\n"Maya, R",maya@example.test,5551234\r\nJordan Lee,jordan@example.test,5555678\r\n';
  const imported = await f.request('POST', `/api/events/${s.eventId}/import/csv`, { headers: { ...s.admin, 'Content-Type': 'text/csv' }, body: csvText, csv: true });
  assert.equal(imported.status, 200, imported.raw); assert.deepEqual(imported.data, { imported: 2, skipped: 0 });
  const roster = await f.request('GET', '/api/guests?q=Maya', { headers: s.monitor });
  assert.equal(roster.status, 200); assert.equal(roster.data.length, 1); monitorPrivate(roster.data);
  const needs = await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in' } });
  assert.deepEqual(needs.data, { needsGuest: true, band: { shortCode: s.bands[0].shortCode } });
  const inScan = await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: roster.data[0].id } });
  assert.equal(inScan.status, 200, inScan.raw); assert.equal(inScan.data.guest.name, 'Maya, R'); monitorPrivate(inScan.data);
  const again = await f.request('POST', '/api/scan', { headers: s.monitor, body: { shortCode: s.bands[0].shortCode, direction: 'in' } });
  assert.equal(again.data.warning, 'already_inside');
  const walkin = await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.monitor, body: { name: 'Sam Walkin', email: 'sam@example.test' } });
  assert.equal(walkin.status, 201, walkin.raw); monitorPrivate(walkin.data);
  const second = await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: walkin.data.guest.id } });
  assert.equal(second.status, 200, second.raw);
  const group = await f.request('POST', '/api/departures', { headers: s.monitor, body: { bandTokens: s.bands.map(b => b.token) } });
  assert.equal(group.status, 200, group.raw); assert.deepEqual(group.data.people.map(x => x.name), ['Maya, R', 'Sam Walkin']); monitorPrivate(group.data);
  const depRows = f.db.prepare('SELECT groupId FROM departures WHERE eventId=?').all(s.eventId);
  assert.equal(depRows.length, 2); assert.equal(depRows[0].groupId, depRows[1].groupId);
  const dashboard = await f.request('GET', '/api/dashboard', { headers: s.monitor });
  assert.equal(dashboard.status, 200, dashboard.raw); monitorPrivate(dashboard.data);
  assert.equal(dashboard.data.left, 2); assert.deepEqual(dashboard.data.roster.find(x => x.name === 'Maya, R').leftWith, ['Sam Walkin']);
  const exported = await f.request('GET', `/api/events/${s.eventId}/export.csv`, { headers: s.admin });
  assert.equal(exported.status, 200); const exportRows = parseCsv(exported.raw);
  assert.ok(exportRows.some(row => row[0] === 'Maya, R' && row[6] === 'Sam Walkin'));
  assert.ok(exportRows.some(row => row[0] === 'Sam Walkin' && row[6] === 'Maya, R'));
  assert.equal((await f.request('GET', `/api/events/${s.eventId}`, { headers: s.admin })).data.stats.groups, 1);
  assert.ok(q(f, "SELECT COUNT(*) n FROM audit WHERE action='roster_export'").n >= 1);
});

test('authorization, one guest per band, and failed relinking', async t => {
  const f = await fixture(); t.after(f.close); const s = await setup(f);
  const g1 = await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'A', email: 'a@example.test' } });
  const g2 = await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'B' } });
  for (const [method, path, body] of [
    ['GET', `/api/events/${s.eventId}`, undefined], ['POST', `/api/events/${s.eventId}/bands`, { count: 1 }],
    ['GET', `/api/events/${s.eventId}/export.csv`, undefined], ['GET', '/api/dashboard', undefined],
    ['GET', '/api/guests?q=A', undefined], ['POST', '/api/scan', { bandToken: s.bands[0].token, direction: 'in' }],
  ]) { const r = await f.request(method, path, { body }); assert.ok([401, 403].includes(r.status), `${path}: ${r.status}`); }
  assert.equal((await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: g1.data.guest.id } })).status, 200);
  const relink = await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: g2.data.guest.id } });
  assert.equal(relink.status, 409); assert.equal(relink.data.error, 'band_already_linked');
  const duplicate = await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1].token, direction: 'in', guestId: g1.data.guest.id } });
  assert.equal(duplicate.status, 409); assert.equal(q(f, 'SELECT guestId FROM bands WHERE token=?', s.bands[0].token).guestId, g1.data.guest.id);
  assert.equal(q(f, 'SELECT guestId FROM bands WHERE token=?', s.bands[1].token).guestId, null);
});

test('Luma import paginates approved guests, updates by external ID and encrypts key', async t => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(options.headers['x-luma-api-key'], 'top-secret');
    assert.equal(url.searchParams.get('event_api_id'), 'evt-demo');
    return { ok: true, json: async () => !url.searchParams.has('pagination_cursor') ? { entries: [
      { guest: { api_id: 'g1', name: 'Maya', email: 'maya@example.test', approval_status: 'approved' } },
      { guest: { api_id: 'g2', name: 'Pending', approval_status: 'pending_approval' } },
    ], has_more: true, next_cursor: 'next' } : { entries: [
      { guest: { api_id: 'g3', name: 'Jordan', approval_status: 'approved' } },
    ], has_more: false } };
  };
  const f = await fixture(fetcher); t.after(f.close); const s = await setup(f);
  const r = await f.request('POST', `/api/events/${s.eventId}/import/luma`, { headers: s.admin, body: { apiKey: 'top-secret', lumaEventId: 'evt-demo' } });
  assert.equal(r.status, 200, r.raw); assert.deepEqual(r.data, { imported: 2, updated: 0 }); assert.equal(calls, 2);
  assert.equal(q(f, 'SELECT COUNT(*) n FROM guests WHERE eventId=?', s.eventId).n, 2);
  const stored = q(f, 'SELECT lumaApiKeyEnc FROM events WHERE id=?', s.eventId).lumaApiKeyEnc;
  assert.ok(stored && !stored.includes('top-secret'));
  const again = await f.request('POST', `/api/events/${s.eventId}/import/luma`, { headers: s.admin, body: { apiKey: 'top-secret', lumaEventId: 'evt-demo' } });
  assert.deepEqual(again.data, { imported: 0, updated: 2 }); assert.equal(calls, 4);
});

test('retention deletes all personal rows and keeps counts only', async t => {
  const f = await fixture(); t.after(f.close); const s = await setup(f);
  const guest = await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Maya', email: 'maya@example.test', phone: '555' } });
  await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: guest.data.guest.id } });
  await f.request('POST', '/api/departures', { headers: s.monitor, body: { bandTokens: [s.bands[0].token] } });
  f.setTime('2026-11-21T03:00:01Z'); createJobs({ db: f.db, now: f.now }).runRetention();
  for (const table of ['events', 'guests', 'bands', 'scans', 'departures', 'monitor_sessions']) assert.equal(q(f, `SELECT COUNT(*) n FROM ${table}`).n, 0, table);
  const rows = f.db.prepare('SELECT action,detail FROM audit').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].action, 'retention_summary');
  assert.deepEqual(JSON.parse(rows[0].detail), { guests: 1, bands: 2, scans: 2, departures: 1 });
  assert.equal(JSON.stringify(rows).includes('Maya'), false);
});

test('2,000-guest scan stays under 50 ms', async t => {
  const f = await fixture(); t.after(f.close); const s = await setup(f, 2000);
  const insert = f.db.prepare('INSERT INTO guests (id,eventId,name,source,createdAt) VALUES (?,?,?,?,?)');
  for (let i = 0; i < 2000; i++) insert.run(`g${i}`, s.eventId, `Guest ${i}`, 'manual', f.now().toISOString());
  const start = performance.now();
  const r = await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[1999].token, direction: 'in', guestId: 'g1999' } });
  const elapsed = performance.now() - start;
  assert.equal(r.status, 200, r.raw); assert.ok(elapsed < 50, `scan took ${elapsed.toFixed(1)} ms`);
});

test('tap route, monitor cookie, CSV and security headers', async t => {
  const f = await fixture(); t.after(f.close); const s = await setup(f);
  const publicTap = await f.request('GET', `/t/${s.bands[0].token}`);
  assert.equal(publicTap.status, 200); assert.match(publicTap.raw, /Homebound safety band/);
  assert.match(publicTap.headers.get('content-security-policy'), /default-src 'self'/);
  const cookie = s.session.headers.get('set-cookie').split(';')[0];
  const tapped = await f.request('GET', `/t/${s.bands[0].token}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(tapped.status, 302); assert.match(tapped.headers.get('location'), /\/door\?bandToken=/);
  const bandsCsv = await f.request('GET', `/api/events/${s.eventId}/bands.csv`, { headers: s.admin });
  assert.equal(bandsCsv.status, 200); assert.match(bandsCsv.raw, /shortCode,url/);
  assert.equal((await f.request('POST', `/api/events/${s.eventId}/end`, { headers: s.admin })).status, 200);
});

test('dashboard SSE requires a token and emits scan and departure events', async t => {
  const f = await fixture(); t.after(f.close); const s = await setup(f, 1);
  assert.equal((await f.request('GET', '/api/dashboard/stream')).status, 401);
  const guest = await f.request('POST', `/api/events/${s.eventId}/guests`, { headers: s.admin, body: { name: 'Maya', email: 'maya@example.test' } });
  const token = s.session.data.monitorToken;
  const abort = new AbortController();
  const stream = await fetch(`${f.base}/api/dashboard/stream?token=${token}`, { signal: abort.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const next = async () => {
    const result = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(Error('SSE timeout')), 2000))]);
    return new TextDecoder().decode(result.value);
  };
  try {
    assert.match(await next(), /connected/);
    await f.request('POST', '/api/scan', { headers: s.monitor, body: { bandToken: s.bands[0].token, direction: 'in', guestId: guest.data.guest.id } });
    const scanEvent = await next(); assert.match(scanEvent, /event: scan/); monitorPrivate(scanEvent);
    await f.request('POST', '/api/departures', { headers: s.monitor, body: { bandTokens: [s.bands[0].token] } });
    let output = ''; for (let i = 0; i < 3 && !output.includes('event: departure'); i++) output += await next();
    assert.match(output, /event: departure/); monitorPrivate(output);
  } finally { abort.abort(); await reader.cancel().catch(() => {}); }
});
