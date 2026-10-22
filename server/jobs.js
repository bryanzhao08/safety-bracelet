import { randomToken } from './tokens.js';

export function createJobs({ db, now = () => new Date() }) {
  let timer;
  function runRetention() {
    const at = new Date(now()).toISOString();
    db.prepare('DELETE FROM idempotency WHERE createdAt <= ?').run(new Date(Date.parse(at) - 48 * 3_600_000).toISOString());
    for (const event of db.prepare('SELECT id, endsAt, retentionDays FROM events').all()) {
      const deadline = Date.parse(event.endsAt) + event.retentionDays * 86_400_000;
      if (Date.parse(at) <= deadline) continue;
      db.exec('BEGIN IMMEDIATE');
      try {
        const count = table => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE eventId = ?`).get(event.id).n;
        const summary = { guests: count('guests'), bands: count('bands'), scans: count('scans'), departures: count('departures') };
        for (const table of ['guests', 'bands', 'scans', 'departures', 'monitor_sessions', 'idempotency', 'audit']) {
          db.prepare(`DELETE FROM ${table} WHERE eventId = ?`).run(event.id);
        }
        db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
        db.prepare('INSERT INTO audit (id,eventId,actor,action,at,detail) VALUES (?,?,?,?,?,?)')
          .run(randomToken(), event.id, 'system', 'retention_summary', at, JSON.stringify(summary));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  }
  function start() {
    if (timer) return;
    runRetention();
    timer = setInterval(() => { try { runRetention(); } catch (e) { console.error('Retention failed:', e); } }, 3_600_000);
    timer.unref?.();
  }
  function stop() { clearInterval(timer); timer = undefined; }
  return { runRetention, start, stop };
}
