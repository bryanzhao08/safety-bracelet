import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';

test('online backup includes WAL data and proxy sets Secure cookie and HTTPS band URLs', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'hb-deploy-'));
  const source = path.join(folder, 'live.sqlite'), destination = path.join(folder, 'backup.sqlite');
  const db = openDb(source);
  const server = createServer({ db, startJobs: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, headers = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', ...headers }, body: JSON.stringify(body),
  });
  try {
    const created = await (await request('/api/events', { name: 'Proxy Test', startsAt: '2026-10-22T20:00:00Z', endsAt: '2026-10-23T03:00:00Z' })).json();
    const session = await request(`/api/events/${created.eventId}/monitor-session`, { monitorCode: created.monitorCode, name: 'Door' });
    assert.equal(session.status, 200);
    assert.match(session.headers.get('set-cookie'), /; Secure(?:;|$)/);
    const bands = await (await request(`/api/events/${created.eventId}/bands`, { count: 1 }, { 'X-Admin-Pin': created.adminPin })).json();
    assert.match(bands.bands[0].url, /^https:\/\//);
    execFileSync(process.execPath, ['scripts/backup.js', destination], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, HB_DB: source } });
    const copy = new DatabaseSync(destination, { readOnly: true });
    try { assert.equal(copy.prepare('SELECT name FROM events WHERE id=?').get(created.eventId).name, 'Proxy Test'); }
    finally { copy.close(); }
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close(); rmSync(folder, { recursive: true, force: true });
  }
});
