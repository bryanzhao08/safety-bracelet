import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const source = resolve(process.env.HB_DB || 'data/homebound-v2.sqlite');
const destination = resolve(process.argv[2] || '/tmp/homebound-backup.sqlite');
if (!existsSync(source)) throw new Error(`Database does not exist: ${source}`);
if (source === destination) throw new Error('Backup destination must differ from source');
mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
} finally {
  db.close();
}
const copy = new DatabaseSync(destination, { readOnly: true });
try {
  if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed');
} finally {
  copy.close();
}
console.log(destination);
