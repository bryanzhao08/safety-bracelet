const MINUTE = 60_000;

function clockMs(now) {
  const value = now();
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error('Invalid job clock');
  return ms;
}

function sharedCircles(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((token) => typeof token === 'string'))] : [];
  } catch {
    return [];
  }
}

function circleAlert(row) {
  const name = row.displayName || 'Your friend';
  const withWhom = row.leavingWith ? `, with ${row.leavingWith}` : '';
  return `${name} hasn't checked in. Last shared: left ${row.leftAt}${withWhom}`;
}

/** Timed guest reminders, circle alerts, and event data retention. */
export function createJobs({ db, now = () => new Date(), notify = async () => {} }) {
  let alertTimer;
  let retentionTimer;
  let alertsRunning = false;
  let retentionRunning = false;

  const insertDelivery = db.prepare('INSERT OR IGNORE INTO alert_deliveries (departureId, stage, sentAt) VALUES (?, ?, ?)');
  const markReminder = db.prepare('UPDATE departures SET reminderAt = ? WHERE id = ? AND status = ?');
  const markNudge = db.prepare('UPDATE departures SET nudgeAt = ? WHERE id = ? AND status = ?');
  const markAlerted = db.prepare("UPDATE departures SET status = 'alerted' WHERE id = ? AND status = 'active'");
  const dueDepartures = db.prepare(`
    SELECT d.*, b.displayName FROM departures d
    LEFT JOIN bands b ON b.token = d.bandToken
    WHERE d.status = 'active' AND d.expectedHomeAt <= ?
    ORDER BY d.expectedHomeAt, d.id
  `);

  async function sendOnce(row, stage, at, target, message) {
    const inserted = insertDelivery.run(row.id, stage, at);
    if (!inserted.changes) return;
    try {
      await notify(target, message);
    } catch (error) {
      // A push outage cannot stop later departures from being processed.
      console.error('Homebound notification failed:', error);
    }
  }

  async function runAlerts() {
    if (alertsRunning) return;
    alertsRunning = true;
    try {
      const current = clockMs(now);
      const at = new Date(current).toISOString();
      for (const row of dueDepartures.all(at)) {
        const due = Date.parse(row.expectedHomeAt);
        if (!Number.isFinite(due) || current < due) continue;
        if (current >= due + 20 * MINUTE) {
          if (markAlerted.run(row.id).changes) {
            for (const circleToken of sharedCircles(row.sharedWith)) {
              await sendOnce(row, `alert:${circleToken}`, at,
                { type: 'circle', circleToken }, circleAlert(row));
            }
          }
          continue;
        }
        if (!row.reminderAt && markReminder.run(at, row.id, 'active').changes) {
          await sendOnce(row, 'reminder', at,
            { type: 'guest', deviceId: row.deviceId }, 'Home safe? Tap to confirm');
        }
        if (current >= due + 10 * MINUTE && !row.nudgeAt && markNudge.run(at, row.id, 'active').changes) {
          await sendOnce(row, 'nudge', at,
            { type: 'guest', deviceId: row.deviceId }, 'Home safe? Tap to confirm');
        }
      }
    } finally {
      alertsRunning = false;
    }
  }

  function runRetention() {
    if (retentionRunning) return;
    retentionRunning = true;
    try {
      const current = clockMs(now);
      const at = new Date(current).toISOString();
      const events = db.prepare('SELECT id, endsAt, retentionHours FROM events').all();
      for (const event of events) {
        const expiration = Date.parse(event.endsAt) + Number(event.retentionHours) * 60 * MINUTE;
        if (!Number.isFinite(expiration) || current <= expiration) continue;

        db.exec('BEGIN IMMEDIATE');
        try {
          const eventDevices = db.prepare(`
            SELECT deviceId FROM bands WHERE eventId = ? AND deviceId IS NOT NULL
            UNION SELECT deviceId FROM departures WHERE eventId = ?
            UNION SELECT deviceId FROM incident_holds WHERE eventId = ?
            UNION SELECT deviceId FROM circles WHERE eventId = ?
          `).all(event.id, event.id, event.id, event.id).map((row) => row.deviceId);
          // A hold preserves that guest's departure records until its own deadline.
          db.prepare(`DELETE FROM departures WHERE eventId = ? AND NOT EXISTS (
            SELECT 1 FROM incident_holds h WHERE h.eventId = departures.eventId
              AND h.deviceId = departures.deviceId AND h.until > ?
          )`).run(event.id, at);
          db.prepare('DELETE FROM alert_deliveries WHERE departureId NOT IN (SELECT id FROM departures)').run();
          db.prepare('DELETE FROM presence WHERE eventId = ?').run(event.id);
          db.prepare('DELETE FROM circle_members WHERE circleToken IN (SELECT token FROM circles WHERE eventId = ?)').run(event.id);
          db.prepare('DELETE FROM circles WHERE eventId = ?').run(event.id);
          db.prepare('UPDATE help_requests SET bandShortCode = NULL WHERE eventId = ?').run(event.id);
          db.prepare(`DELETE FROM guest_push WHERE deviceId IN (
            SELECT DISTINCT deviceId FROM bands WHERE eventId = ? AND deviceId IS NOT NULL
          ) AND deviceId NOT IN (
            SELECT deviceId FROM bands WHERE eventId <> ? AND deviceId IS NOT NULL
          )`).run(event.id, event.id);
          db.prepare('UPDATE bands SET deviceId = NULL, displayName = NULL WHERE eventId = ?').run(event.id);
          db.prepare('DELETE FROM incident_holds WHERE eventId = ? AND until <= ?').run(event.id, at);
          const deleteOrphanDevice = db.prepare(`DELETE FROM devices WHERE id = ?
            AND NOT EXISTS (SELECT 1 FROM bands WHERE deviceId = devices.id)
            AND NOT EXISTS (SELECT 1 FROM departures WHERE deviceId = devices.id)
            AND NOT EXISTS (SELECT 1 FROM circles WHERE deviceId = devices.id)
            AND NOT EXISTS (SELECT 1 FROM incident_holds WHERE deviceId = devices.id)`);
          for (const deviceId of eventDevices) deleteOrphanDevice.run(deviceId);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
    } finally {
      retentionRunning = false;
    }
  }

  function start() {
    if (alertTimer || retentionTimer) return;
    runAlerts().catch((error) => console.error('Homebound alert job failed:', error));
    try { runRetention(); } catch (error) { console.error('Homebound retention job failed:', error); }
    alertTimer = setInterval(() => runAlerts().catch((error) => console.error('Homebound alert job failed:', error)), 30_000);
    retentionTimer = setInterval(() => {
      try { runRetention(); } catch (error) { console.error('Homebound retention job failed:', error); }
    }, 10 * MINUTE);
    alertTimer.unref?.();
    retentionTimer.unref?.();
  }

  function stop() {
    clearInterval(alertTimer);
    clearInterval(retentionTimer);
    alertTimer = retentionTimer = undefined;
  }

  return { runAlerts, runRetention, tickAlerts: runAlerts, tickRetention: runRetention, start, stop };
}
