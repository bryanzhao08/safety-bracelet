import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_VAPID_PATH = 'data/vapid.json';

function parseSubscription(value) {
  try {
    const subscription = typeof value === 'string' ? JSON.parse(value) : value;
    if (subscription && typeof subscription.endpoint === 'string') return subscription;
  } catch { /* Invalid saved subscription; omit it. */ }
  return null;
}

function payloadFor(target, message, guestUrl) {
  if (message && typeof message === 'object') return JSON.stringify(message);
  const url = target.type === 'circle' ? `/c/${encodeURIComponent(target.circleToken)}` : guestUrl;
  return JSON.stringify({ title: 'Homebound', body: String(message), url });
}

/** Web Push delivery with a console fallback when web-push is unavailable. */
export async function createNotifier({ db, vapidPath = DEFAULT_VAPID_PATH, log = console } = {}) {
  let webPush;
  try {
    webPush = (await import('web-push')).default;
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }

  let publicKey = null;
  if (webPush) {
    let keys;
    try {
      keys = JSON.parse(await readFile(vapidPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      keys = webPush.generateVAPIDKeys();
      await mkdir(dirname(vapidPath), { recursive: true });
      try {
        await writeFile(vapidPath, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
        keys = JSON.parse(await readFile(vapidPath, 'utf8'));
      }
    }
    if (!keys.publicKey || !keys.privateKey) throw new Error('Invalid VAPID keys');
    publicKey = keys.publicKey;
    webPush.setVapidDetails('mailto:admin@homebound.local', keys.publicKey, keys.privateKey);
  }

  const guestSubscription = db.prepare('SELECT subscription FROM guest_push WHERE deviceId = ?');
  const circleSubscriptions = db.prepare('SELECT id, pushSubscription FROM circle_members WHERE circleToken = ?');
  const clearGuest = db.prepare('DELETE FROM guest_push WHERE deviceId = ?');
  const clearCircleMember = db.prepare('UPDATE circle_members SET pushSubscription = NULL WHERE id = ?');
  const guestBand = db.prepare(`SELECT bandToken AS token FROM departures WHERE deviceId = ?
    ORDER BY leftAt DESC LIMIT 1`);
  const linkedBand = db.prepare('SELECT token FROM bands WHERE deviceId = ? ORDER BY createdAt DESC LIMIT 1');

  async function deliver(subscription, target, message, onExpired, guestUrl) {
    if (!subscription || !webPush) {
      log.info?.('Homebound notification:', { target: target.type, message });
      return;
    }
    try {
      await webPush.sendNotification(subscription, payloadFor(target, message, guestUrl));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        onExpired();
        return;
      }
      log.error?.('Homebound web push failed:', error.statusCode || error.message);
      log.info?.('Homebound notification fell back to console:', { target: target.type });
    }
  }

  async function notify(target, message) {
    if (target?.type === 'guest' && typeof target.deviceId === 'string') {
      const subscription = parseSubscription(guestSubscription.get(target.deviceId)?.subscription);
      const token = guestBand.get(target.deviceId)?.token || linkedBand.get(target.deviceId)?.token;
      const guestUrl = token ? `/b/${encodeURIComponent(token)}` : '/';
      await deliver(subscription, target, message, () => clearGuest.run(target.deviceId), guestUrl);
      return;
    }
    if (target?.type === 'circle' && typeof target.circleToken === 'string') {
      const members = circleSubscriptions.all(target.circleToken);
      if (!members.length) {
        log.info?.('Homebound notification:', { target: 'circle', message });
        return;
      }
      await Promise.all(members.map((member) => deliver(
        parseSubscription(member.pushSubscription), target, message,
        () => clearCircleMember.run(member.id),
      )));
      return;
    }
    throw new TypeError('Unknown notification target');
  }

  return { notify, publicKey };
}
