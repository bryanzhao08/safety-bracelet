import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDb } from '../server/db.js';
import { serverSecret } from '../server/id-checkin.js';
import { encryptApiKey } from '../server/imports.js';

test('HB_DB and HB_DATA_DIR select the database and secret paths', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'homebound-config-'));
  const dbFile = path.join(folder, 'db', 'custom.sqlite');
  const secretDir = path.join(folder, 'keys');
  const previousDb = process.env.HB_DB, previousDir = process.env.HB_DATA_DIR;
  try {
    process.env.HB_DB = dbFile;
    process.env.HB_DATA_DIR = secretDir;
    const db = openDb();
    db.prepare('INSERT INTO events (id,name,startsAt,endsAt,adminPinHash,monitorCode,createdAt) VALUES (?,?,?,?,?,?,?)')
      .run('test', 'Test', '2026-10-22T00:00:00Z', '2026-10-23T00:00:00Z', 'hash', 'ABCDEF', '2026-10-22T00:00:00Z');
    db.close();
    assert.ok(existsSync(dbFile));
    assert.equal(serverSecret().length, 32);
    const secretFile = path.join(secretDir, 'secret.json');
    assert.ok(existsSync(secretFile));
    assert.equal(statSync(secretFile).mode & 0o777, 0o600);
    assert.ok(!encryptApiKey('luma-private-key').includes('luma-private-key'));
    assert.match(readFileSync(secretFile, 'utf8'), /"key"/);
    assert.equal(existsSync(path.join(folder, 'server-secret')), false);
  } finally {
    if (previousDb === undefined) delete process.env.HB_DB; else process.env.HB_DB = previousDb;
    if (previousDir === undefined) delete process.env.HB_DATA_DIR; else process.env.HB_DATA_DIR = previousDir;
    rmSync(folder, { recursive: true, force: true });
  }
});

test('startup filters only the node:sqlite experimental warning', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import './server/index.js'; process.emitWarning('sentinel warning')"],
    { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes('SQLite is an experimental feature'), false);
  assert.match(result.stderr, /sentinel warning/);
});
