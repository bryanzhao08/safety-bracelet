import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';
import { parseCsv } from '../server/imports.js';

test('a full party keeps ID data private from monitors, responses and SQLite', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'homebound-party-'));
  const dbFile = path.join(folder, 'party.sqlite');
  const db = openDb(dbFile);
  const server = createServer({ db, startJobs: false, idSecretPath: path.join(folder, 'secret.json') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise(resolve => server.close(resolve));
    db.close();
  };
  const request = async (method, route, { body, headers = {}, csv = false } = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(!csv && body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : csv ? body : JSON.stringify(body),
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, data, raw };
  };
  const monitorResponses = [];
  const monitorRequest = async (method, route, options) => {
    const result = await request(method, route, options);
    monitorResponses.push(result.raw);
    return result;
  };
  const licenseNumber = 'UNIQUE-LICENSE-7392846';
  const phone = '415-555-0173', jordanPhone = '415-555-0199', averyPhone = '415-555-0111';
  try {
    const event = await request('POST', '/api/events', { body: {
      name: 'October Party', startsAt: '2026-10-21T20:00:00Z', endsAt: '2026-10-22T03:00:00Z',
    } });
    assert.equal(event.status, 201, event.raw);
    const { eventId, adminPin, monitorCode } = event.data;
    const admin = { 'X-Admin-Pin': adminPin };
    const importCsv = [
      'Name,Email,Phone Number,Status',
      `Maya Lee,maya@example.test,${phone},Going`,
      `Jordan Kim,jordan@example.test,${jordanPhone},Going`,
      `Avery Chen,avery@example.test,${averyPhone},Going`,
    ].join('\r\n') + '\r\n';
    const imported = await request('POST', `/api/events/${eventId}/import/csv`, {
      headers: { ...admin, 'Content-Type': 'text/csv' }, body: importCsv, csv: true,
    });
    assert.deepEqual(imported.data, { imported: 3, skipped: 0, skippedReasons: {} });
    const made = await request('POST', `/api/events/${eventId}/bands`, { headers: admin, body: { count: 5 } });
    assert.equal(made.status, 200, made.raw);
    assert.equal(made.data.bands.length, 5);
    const bands = made.data.bands;
    const session = await monitorRequest('POST', `/api/events/${eventId}/monitor-session`, { body: { monitorCode, name: 'Door' } });
    assert.equal(session.status, 200, session.raw);
    const monitor = { Authorization: `Bearer ${session.data.monitorToken}` };
    const idFields = {
      firstName: 'Maya', lastName: 'Lee', dob: '2000-05-10', idState: 'CA',
      idExpires: '2028-01-01', licenseNumber,
    };
    const maya = await monitorRequest('POST', '/api/id-checkin', { headers: monitor, body: idFields });
    assert.equal(maya.status, 200, maya.raw);
    assert.equal(maya.data.guest.name, 'Maya Lee');
    assert.equal(maya.data.over21, true);
    const needsMaya = await monitorRequest('POST', '/api/scan', { headers: monitor, body: { bandToken: bands[0].token, direction: 'in' } });
    assert.equal(needsMaya.data.needsGuest, true);
    const mayaIn = await monitorRequest('POST', '/api/scan', { headers: monitor, body: {
      bandToken: bands[0].token, direction: 'in', guestId: maya.data.guest.id,
    } });
    assert.equal(mayaIn.status, 200, mayaIn.raw);
    const duplicate = await monitorRequest('POST', '/api/id-checkin', { headers: monitor, body: idFields });
    assert.equal(duplicate.data.duplicate.guestId, maya.data.guest.id);
    const under21 = await monitorRequest('POST', '/api/id-checkin', { headers: monitor, body: {
      firstName: 'Casey', lastName: 'Young', dob: '2008-06-15', idState: 'CA',
      idExpires: '2028-01-01', licenseNumber: 'WALKIN-UNDER21-6254',
    } });
    assert.equal(under21.data.created, true);
    assert.equal(under21.data.over21, false);
    const jordanSearch = await monitorRequest('GET', '/api/guests?q=Jordan', { headers: monitor });
    const jordanId = jordanSearch.data[0].id;
    const needsJordan = await monitorRequest('POST', '/api/scan', { headers: monitor, body: { bandToken: bands[1].token, direction: 'in' } });
    assert.equal(needsJordan.data.needsGuest, true);
    const jordanIn = await monitorRequest('POST', '/api/scan', { headers: monitor, body: {
      bandToken: bands[1].token, direction: 'in', guestId: jordanId,
    } });
    assert.equal(jordanIn.status, 200, jordanIn.raw);
    const averySearch = await monitorRequest('GET', '/api/guests?q=Avery', { headers: monitor });
    const averyIn = await monitorRequest('POST', '/api/scan', { headers: monitor, body: {
      bandToken: bands[2].token, direction: 'in', guestId: averySearch.data[0].id,
    } });
    assert.equal(averyIn.status, 200, averyIn.raw);
    const departed = await monitorRequest('POST', '/api/departures', { headers: monitor, body: {
      bandTokens: [bands[0].token, bands[1].token],
    } });
    assert.equal(departed.status, 200, departed.raw);
    assert.deepEqual(departed.data.people.map(person => person.name), ['Maya Lee', 'Jordan Kim']);
    const dashboard = await monitorRequest('GET', '/api/dashboard', { headers: monitor });
    assert.equal(dashboard.status, 200, dashboard.raw);
    assert.equal(dashboard.data.inside, 1);
    assert.deepEqual(dashboard.data.roster.find(person => person.name === 'Maya Lee').leftWith, ['Jordan Kim']);
    assert.equal(dashboard.data.roster.find(person => person.name === 'Avery Chen').status, 'inside');
    const exported = await request('GET', `/api/events/${eventId}/export.csv`, { headers: admin });
    assert.equal(exported.status, 200, exported.raw);
    const mayaRow = parseCsv(exported.raw).find(row => row[0] === 'Maya Lee');
    assert.equal(mayaRow[1], 'maya@example.test');
    assert.equal(mayaRow[6], 'Jordan Kim');
    const forbiddenExport = await monitorRequest('GET', `/api/events/${eventId}/export.csv`, { headers: monitor });
    assert.equal(forbiddenExport.status, 403);
    for (const raw of monitorResponses) {
      for (const privateValue of ['@example.test', phone, jordanPhone, averyPhone, licenseNumber, 'WALKIN-UNDER21-6254']) {
        assert.equal(raw.includes(privateValue), false, `monitor response leaked ${privateValue}: ${raw}`);
      }
    }
    await close();
    for (const file of readdirSync(folder)) {
      const bytes = readFileSync(path.join(folder, file));
      assert.equal(bytes.includes(Buffer.from(licenseNumber)), false, `${file} contains raw license number`);
    }
  } finally {
    await close();
    rmSync(folder, { recursive: true, force: true });
  }
});
