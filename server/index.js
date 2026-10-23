import './warnings.js';
import http from 'node:http';
import { createHash, randomInt } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from './db.js';
import { randomToken, shortCode, secureEqual, hashPin, verifyPin } from './tokens.js';
import { csvGuests, csvEscape, encryptApiKey, fetchLumaGuests } from './imports.js';
import { ageAndExpiry, licenseHash, matchGuests, validDate } from './id-checkin.js';
import { createJobs } from './jobs.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const fail = (status, error, message = error.replaceAll('_', ' ')) => Object.assign(new Error(message), { status, error });
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const iso = value => new Date(value).toISOString();
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const code6 = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');

export function createServer({ db = openDb(), now = () => new Date(), fetcher = fetch, startJobs = true, idSecretPath } = {}) {
  const jobs = createJobs({ db, now });
  const streams = new Map(), rates = new Map();
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const many = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const at = () => iso(now());
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const csv = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment', 'Cache-Control': 'no-store' }); res.end(body); };
  const readBody = async (req, limit = 2_000_000) => {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'too_large'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  };
  const body = async req => { const raw = await readBody(req, 65_536); if (!raw) return {}; try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; } catch { throw fail(400, 'invalid_json'); } };
  const event = id => one('SELECT * FROM events WHERE id=?', id) ?? (() => { throw fail(404, 'event_not_found'); })();
  const admin = (req, id) => { const e = event(id), pin = req.headers['x-admin-pin']; if (typeof pin !== 'string' || !verifyPin(pin, e.adminPinHash)) throw fail(403, 'admin_required'); return e; };
  const bearer = req => req.headers.authorization?.match(/^Bearer ([0-9a-f]{32})$/)?.[1];
  const monitor = (req, url, query = false) => {
    const token = query ? url.searchParams.get('token') : bearer(req);
    if (!token) throw fail(401, 'monitor_required');
    const session = one('SELECT * FROM monitor_sessions WHERE token=?', token);
    if (!session || !secureEqual(token, session.token) || !one('SELECT id FROM events WHERE id=?', session.eventId)) throw fail(403, 'monitor_required');
    return session;
  };
  const bandFor = (session, value, byCode = false) => {
    const band = one(byCode ? 'SELECT * FROM bands WHERE eventId=? AND shortCode=?' : 'SELECT * FROM bands WHERE eventId=? AND token=?', session.eventId, value);
    if (!band) throw fail(404, 'band_not_found');
    return band;
  };
  const lastScan = token => one('SELECT direction,at FROM scans WHERE bandToken=? ORDER BY at DESC,id DESC LIMIT 1', token);
  const inside = token => lastScan(token)?.direction === 'in';
  const insideCount = id => one(`SELECT COUNT(*) n FROM bands b WHERE b.eventId=? AND
    (SELECT direction FROM scans s WHERE s.bandToken=b.token ORDER BY at DESC,id DESC LIMIT 1)='in'`, id).n;
  const counts = id => ({
    guests: one('SELECT COUNT(*) n FROM guests WHERE eventId=?', id).n,
    bands: one('SELECT COUNT(*) n FROM bands WHERE eventId=?', id).n,
    inside: insideCount(id),
    checkedIn: one("SELECT COUNT(DISTINCT guestId) n FROM scans WHERE eventId=? AND direction='in' AND guestId IS NOT NULL", id).n,
    left: one('SELECT COUNT(DISTINCT guestId) n FROM departures WHERE eventId=? AND guestId IS NOT NULL', id).n,
    groups: one('SELECT COUNT(DISTINCT groupId) n FROM departures WHERE eventId=?', id).n,
  });
  const audit = (id, actor, action, detail = {}) => run('INSERT INTO audit (id,eventId,actor,action,at,detail) VALUES (?,?,?,?,?,?)', randomToken(), id, actor, action, at(), JSON.stringify(detail));
  const emit = (id, type, data) => { for (const res of streams.get(id) ?? []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
  const emitStats = id => { const s = counts(id); emit(id, 'stats', { inside: s.inside, checkedIn: s.checkedIn, left: s.left }); };
  const httpsRequest = req => req.socket.encrypted || req.headers['x-forwarded-proto']?.split(',')[0]?.trim().toLowerCase() === 'https';
  const baseUrl = req => `${httpsRequest(req) ? 'https' : 'http'}://${req.headers.host}`;
  const rate = (key, max, ms) => { const t = new Date(now()).getTime(), recent = (rates.get(key) ?? []).filter(x => t - x < ms); if (recent.length >= max) throw fail(429, 'rate_limited'); recent.push(t); rates.set(key, recent); };
  const idempotency = (req, res, eventId) => {
    const key = req.headers['idempotency-key'];
    if (key === undefined) return { respond: (status, value) => json(res, status, value) };
    if (typeof key !== 'string' || key.length < 1 || key.length > 64 || /[\x00-\x1f\x7f]/.test(key)) throw fail(400, 'invalid_idempotency_key');
    const route = req.url.split('?')[0], keyHash = createHash('sha256').update(key).digest('hex');
    const saved = one('SELECT status,response,createdAt FROM idempotency WHERE eventId=? AND route=? AND key=?', eventId, route, keyHash);
    if (saved && Date.parse(saved.createdAt) > Date.parse(at()) - 48 * 3_600_000) {
      const value = JSON.parse(saved.response);
      if (route.endsWith('/monitor-session')) res.setHeader('Set-Cookie', `hb_monitor=${value.monitorToken}; Path=/; HttpOnly; SameSite=Lax${httpsRequest(req) ? '; Secure' : ''}`);
      json(res, saved.status, value);
      return { replayed: true };
    }
    return { respond: (status, value) => {
      run('INSERT OR REPLACE INTO idempotency (eventId,route,key,status,response,createdAt) VALUES (?,?,?,?,?,?)', eventId, route, keyHash, status, JSON.stringify(value), at());
      json(res, status, value);
    } };
  };
  const publicEvent = e => ({ id: e.id, name: e.name, startsAt: e.startsAt, endsAt: e.endsAt, retentionDays: e.retentionDays, capacity: e.capacity, createdAt: e.createdAt });
  const guestPublic = g => ({ id: g.id, name: g.name });
  const addGuest = (id, g, source, externalId = null) => {
    const guestId = randomToken();
    run('INSERT INTO guests (id,eventId,name,email,phone,source,externalId,createdAt) VALUES (?,?,?,?,?,?,?,?)', guestId, id, g.name.trim(), g.email?.trim() || null, g.phone?.trim() || null, source, externalId, at());
    return guestId;
  };

  async function api(req, res, url) {
    const p = url.pathname, method = req.method; let m;
    if (method === 'POST' && p === '/api/pilot') {
      const b = await body(req);
      if (!text(b.chapter, 120) || !text(b.school, 120) || !text(b.email, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) ||
          (b.eventSize !== undefined && (!Number.isInteger(b.eventSize) || b.eventSize < 1)) ||
          (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 2000))) throw fail(400, 'invalid_pilot');
      rate(`pilot:${req.headers['fly-client-ip'] || req.socket.remoteAddress}`, 5, 3_600_000);
      const id = randomToken();
      run('INSERT INTO pilot_signups (id,chapter,school,email,eventSize,note,createdAt) VALUES (?,?,?,?,?,?,?)',
        id, b.chapter.trim(), b.school.trim(), b.email.trim(), b.eventSize ?? null, b.note?.trim() || null, at());
      return json(res, 201, { id });
    }
    if (method === 'GET' && p === '/api/pilot') {
      const owner = process.env.HB_OWNER_TOKEN;
      if (!owner || !secureEqual(req.headers['x-owner-token'], owner)) throw fail(403, 'owner_required');
      return json(res, 200, many('SELECT id,chapter,school,email,eventSize,note,createdAt FROM pilot_signups ORDER BY createdAt DESC,id DESC'));
    }
    if (method === 'POST' && p === '/api/events') {
      const b = await body(req);
      if (!text(b.name, 120) || !Number.isFinite(Date.parse(b.startsAt)) || !Number.isFinite(Date.parse(b.endsAt)) || Date.parse(b.endsAt) <= Date.parse(b.startsAt)) throw fail(400, 'invalid_event');
      const id = randomToken(), pin = String(randomInt(100_000_000)).padStart(8, '0'), code = code6();
      run('INSERT INTO events (id,name,startsAt,endsAt,adminPinHash,monitorCode,createdAt) VALUES (?,?,?,?,?,?,?)', id, b.name.trim(), iso(b.startsAt), iso(b.endsAt), hashPin(pin), code, at());
      audit(id, 'organizer', 'event_created');
      return json(res, 201, { eventId: id, adminPin: pin, monitorCode: code });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/monitor-session$/)) && method === 'POST') {
      const e = event(m[1]), b = await body(req);
      if (!text(b.name, 80) || !text(b.monitorCode, 6) || !secureEqual(b.monitorCode, e.monitorCode)) throw fail(403, 'invalid_monitor_code');
      const idem = idempotency(req, res, e.id); if (idem.replayed) return;
      const token = randomToken();
      run('INSERT INTO monitor_sessions (token,eventId,name,createdAt) VALUES (?,?,?,?)', token, e.id, b.name.trim(), at());
      res.setHeader('Set-Cookie', `hb_monitor=${token}; Path=/; HttpOnly; SameSite=Lax${httpsRequest(req) ? '; Secure' : ''}`);
      return idem.respond(200, { monitorToken: token, event: { id: e.id, name: e.name } });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/import\/luma$/)) && method === 'POST') {
      admin(req, m[1]); const b = await body(req);
      if (!text(b.apiKey, 500) || !text(b.lumaEventId, 200)) throw fail(400, 'invalid_luma_import');
      let rows;
      try { rows = await fetchLumaGuests({ apiKey: b.apiKey, lumaEventId: b.lumaEventId, fetcher }); }
      catch (error) { throw fail(502, 'luma_import_failed', error.message); }
      let imported = 0, updated = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const g of rows) {
          const existing = g.externalId ? one("SELECT id FROM guests WHERE eventId=? AND source='luma' AND externalId=?", m[1], g.externalId) : g.email ? one('SELECT id FROM guests WHERE eventId=? AND lower(email)=lower(?)', m[1], g.email) : null;
          if (existing) { run('UPDATE guests SET name=?,email=?,phone=? WHERE id=?', g.name, g.email, g.phone, existing.id); updated++; }
          else { addGuest(m[1], g, 'luma', g.externalId); imported++; }
        }
        run('UPDATE events SET lumaEventId=?,lumaApiKeyEnc=? WHERE id=?', b.lumaEventId, encryptApiKey(b.apiKey, idSecretPath), m[1]);
        audit(m[1], 'organizer', 'luma_import', { imported, updated });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { imported, updated });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/import\/csv$/)) && method === 'POST') {
      admin(req, m[1]);
      if (!req.headers['content-type']?.startsWith('text/csv')) throw fail(415, 'csv_required');
      let rows; try { rows = csvGuests(await readBody(req)); } catch (error) { throw fail(400, 'invalid_csv', error.message); }
      let imported = 0, skipped = 0; const skippedReasons = {}; db.exec('BEGIN IMMEDIATE');
      try {
        const seen = new Set();
        const skip = reason => { skipped++; skippedReasons[reason] = (skippedReasons[reason] || 0) + 1; };
        for (const g of rows) {
          if (g.skipReason) { skip(g.skipReason); continue; }
          if (!text(g.name, 200)) { skip('missing_name'); continue; }
          const key = g.email?.toLowerCase() || `${g.name.toLowerCase()}|${g.phone || ''}`;
          if (seen.has(key) || (g.email && one('SELECT id FROM guests WHERE eventId=? AND lower(email)=lower(?)', m[1], g.email))) { skip('duplicate'); continue; }
          seen.add(key); addGuest(m[1], g, 'partiful'); imported++;
        }
        audit(m[1], 'organizer', 'csv_import', { imported, skipped, skippedReasons }); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { imported, skipped, skippedReasons });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/guests$/)) && method === 'POST') {
      const e = event(m[1]); let actor;
      if (req.headers['x-admin-pin']) { admin(req, e.id); actor = 'organizer'; }
      else { const session = monitor(req, url); if (session.eventId !== e.id) throw fail(403, 'wrong_event'); actor = session.name; }
      const idem = actor === 'organizer' ? null : idempotency(req, res, e.id); if (idem?.replayed) return;
      const b = await body(req);
      if (!text(b.name, 200) || (b.email != null && typeof b.email !== 'string') || (b.phone != null && typeof b.phone !== 'string')) throw fail(400, 'invalid_guest');
      const id = addGuest(e.id, b, 'manual'); audit(e.id, actor, 'guest_created', { guestId: id });
      return idem ? idem.respond(201, { guest: { id, name: b.name.trim() } }) : json(res, 201, { guest: { id, name: b.name.trim() } });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/bands\.csv$/)) && method === 'GET') {
      admin(req, m[1]); audit(m[1], 'organizer', 'bands_export');
      return csv(res, 'shortCode,url\r\n' + many('SELECT token,shortCode FROM bands WHERE eventId=? ORDER BY createdAt,shortCode', m[1]).map(b => `${b.shortCode},${baseUrl(req)}/t/${b.token}\r\n`).join(''));
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/bands$/)) && method === 'POST') {
      admin(req, m[1]); const b = await body(req); if (!Number.isInteger(b.count) || b.count < 1 || b.count > 2000) throw fail(400, 'invalid_count');
      const insert = db.prepare('INSERT INTO bands (token,eventId,shortCode,createdAt) VALUES (?,?,?,?)'), bands = [];
      db.exec('BEGIN IMMEDIATE'); try {
        for (let i = 0; i < b.count; i++) { let code; do { code = shortCode(); } while (one('SELECT 1 FROM bands WHERE eventId=? AND shortCode=?', m[1], code)); const token = randomToken(); insert.run(token, m[1], code, at()); bands.push({ token, shortCode: code, url: `${baseUrl(req)}/t/${token}` }); }
        audit(m[1], 'organizer', 'bands_created', { count: b.count }); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { bands });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/export\.csv$/)) && method === 'GET') {
      admin(req, m[1]); audit(m[1], 'organizer', 'roster_export');
      const guests = many('SELECT * FROM guests WHERE eventId=? ORDER BY name,id', m[1]);
      const bands = many('SELECT * FROM bands WHERE eventId=?', m[1]);
      const scans = many('SELECT * FROM scans WHERE eventId=? ORDER BY at,id', m[1]);
      const deps = many('SELECT * FROM departures WHERE eventId=? ORDER BY at,id', m[1]);
      const byGroup = new Map(); for (const d of deps) { if (!byGroup.has(d.groupId)) byGroup.set(d.groupId, []); byGroup.get(d.groupId).push(d); }
      const byId = new Map(guests.map(g => [g.id, g]));
      const lines = ['name,email,phone,band,first in,last out,left with'];
      for (const g of guests) {
        const gb = bands.filter(b => b.guestId === g.id), tokens = new Set(gb.map(b => b.token));
        const gs = scans.filter(s => s.guestId === g.id), gd = deps.filter(d => d.guestId === g.id);
        const first = gs.find(s => s.direction === 'in')?.at || '', last = gs.filter(s => s.direction === 'out').at(-1)?.at || '';
        const latest = gd.at(-1), mates = latest ? byGroup.get(latest.groupId).filter(d => d.guestId !== g.id).map(d => byId.get(d.guestId)?.name).filter(Boolean) : [];
        lines.push([g.name, g.email, g.phone, gb.map(b => b.shortCode).join('; '), first, last, mates.join('; ')].map(csvEscape).join(','));
      }
      return csv(res, lines.join('\r\n') + '\r\n');
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/end$/)) && method === 'POST') {
      admin(req, m[1]); const ended = at(); run('UPDATE events SET endsAt=? WHERE id=?', ended, m[1]); audit(m[1], 'organizer', 'event_ended'); return json(res, 200, { endsAt: ended });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)\/guests\/([^/]+)\/timeline$/)) && method === 'GET') {
      admin(req, m[1]);
      audit(m[1], 'organizer', 'guest_timeline_lookup', { guestId: m[2] });
      const guest = one('SELECT id,name,email,phone,over21,idState,idScannedAt FROM guests WHERE eventId=? AND id=?', m[1], m[2]);
      if (!guest) throw fail(404, 'guest_not_found');
      const band = one('SELECT token,shortCode FROM bands WHERE eventId=? AND guestId=?', m[1], guest.id);
      const scans = many(`SELECT s.at,s.direction,s.monitorName,b.shortCode FROM scans s
        LEFT JOIN bands b ON b.token=s.bandToken WHERE s.eventId=? AND s.guestId=? ORDER BY s.at,s.id`, m[1], guest.id);
      const departures = many(`SELECT d.at,d.groupId,b.shortCode FROM departures d
        LEFT JOIN bands b ON b.token=d.bandToken WHERE d.eventId=? AND d.guestId=? ORDER BY d.at,d.id`, m[1], guest.id);
      const companions = groupId => many(`SELECT g.id,g.name,g.phone FROM departures d
        JOIN guests g ON g.id=d.guestId WHERE d.eventId=? AND d.groupId=? AND d.guestId<>?
        ORDER BY g.name,g.id`, m[1], groupId, guest.id);
      const events = scans.map(scan => ({ at: scan.at, type: scan.direction,
        detail: { band: scan.shortCode, monitorName: scan.monitorName } }));
      for (const departure of departures) events.push({ at: departure.at, type: 'departure',
        detail: { band: departure.shortCode, groupId: departure.groupId,
          leftWith: companions(departure.groupId).map(person => person.name) } });
      if (guest.idScannedAt) events.push({ at: guest.idScannedAt, type: 'id_check',
        detail: { over21: Boolean(guest.over21) } });
      events.sort((a, b) => a.at.localeCompare(b.at));
      const lastDeparture = departures.at(-1);
      const leftWith = lastDeparture ? companions(lastDeparture.groupId).map(person => ({
        name: person.name, ...(person.phone ? { phone: person.phone } : {}),
      })) : [];
      const lastInside = scans.filter(scan => scan.direction === 'in').at(-1)?.at;
      return json(res, 200, {
        guest: { name: guest.name, email: guest.email, phone: guest.phone,
          ...(guest.over21 === null ? {} : { over21: Boolean(guest.over21) }),
          ...(guest.idState ? { idState: guest.idState } : {}) },
        ...(band ? { band: { shortCode: band.shortCode } } : {}),
        events, leftWith, ...(lastInside ? { lastSeenInsideAt: lastInside } : {}),
      });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)$/)) && method === 'GET') {
      const e = admin(req, m[1]); audit(e.id, 'organizer', 'event_lookup'); return json(res, 200, { event: publicEvent(e), stats: counts(e.id) });
    }
    if ((m = p.match(/^\/api\/events\/([^/]+)$/)) && method === 'PATCH') {
      const e = admin(req, m[1]), b = await body(req);
      if ((!Object.hasOwn(b, 'capacity') && !Object.hasOwn(b, 'name')) ||
          (Object.hasOwn(b, 'capacity') && (!Number.isInteger(b.capacity) || b.capacity < 1)) ||
          (Object.hasOwn(b, 'name') && !text(b.name, 120))) throw fail(400, 'invalid_event');
      run('UPDATE events SET name=?,capacity=? WHERE id=?', b.name?.trim() ?? e.name, b.capacity ?? e.capacity, e.id);
      audit(e.id, 'organizer', 'event_updated', { name: b.name?.trim(), capacity: b.capacity });
      return json(res, 200, { event: publicEvent(event(e.id)) });
    }
    if (method === 'POST' && p === '/api/id-checkin') {
      const session = monitor(req, url), idem = idempotency(req, res, session.eventId); if (idem.replayed) return;
      const b = await body(req), e = event(session.eventId);
      if (!text(b.firstName, 100) || !text(b.lastName, 100) ||
          !validDate(b.dob) || !validDate(b.idExpires) ||
          typeof b.idState !== 'string' || !/^[A-Za-z]{2}$/.test(b.idState.trim()) ||
          typeof b.licenseNumber !== 'string' || !b.licenseNumber.trim() ||
          b.licenseNumber.length > 80 || /[\x00-\x1f\x7f]/.test(b.licenseNumber) ||
          b.dob > e.startsAt.slice(0, 10)) throw fail(400, 'invalid_id_fields');
      const { over21, expired } = ageAndExpiry(b.dob, b.idExpires, e.startsAt);
      const idHash = licenseHash(e.id, b.idState, b.licenseNumber, idSecretPath);
      const previous = one('SELECT id,name,idScannedAt FROM guests WHERE eventId=? AND idHash=?', e.id, idHash);
      if (previous) {
        audit(e.id, session.name, 'id_duplicate', { guestId: previous.id });
        return idem.respond(200, { guest: guestPublic(previous), over21, expired, duplicate: { guestId: previous.id, at: previous.idScannedAt } });
      }
      const matches = matchGuests(many('SELECT id,name FROM guests WHERE eventId=?', e.id), b.firstName, b.lastName);
      if (matches.length > 1) {
        audit(e.id, session.name, 'id_ambiguous', { candidates: matches.length });
        return idem.respond(200, { candidates: matches.map(guestPublic), over21, expired });
      }
      let guest, created = false;
      if (matches.length) {
        guest = matches[0];
        if (one('SELECT idHash FROM guests WHERE id=?', guest.id).idHash) throw fail(409, 'id_already_verified');
      } else {
        const name = `${b.firstName.trim()} ${b.lastName.trim()}`;
        guest = { id: addGuest(e.id, { name }, 'id'), name }; created = true;
      }
      run('UPDATE guests SET dob=?,over21=?,idState=?,idExpires=?,idHash=?,idScannedAt=? WHERE id=?',
        b.dob, Number(over21), b.idState.trim().toUpperCase(), b.idExpires, idHash, at(), guest.id);
      audit(e.id, session.name, 'id_checkin', { guestId: guest.id, created });
      return idem.respond(200, { guest: guestPublic(guest), ...(created ? { created: true } : {}), over21, expired });
    }
    if (method === 'GET' && p === '/api/guests') {
      const session = monitor(req, url), q = url.searchParams.get('q')?.trim() || '';
      if (q.length > 100) throw fail(400, 'invalid_query');
      const guests = many('SELECT id,name,over21 FROM guests WHERE eventId=? AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 100', session.eventId, `%${q}%`);
      const result = guests.map(g => { const b = one('SELECT token,shortCode FROM bands WHERE eventId=? AND guestId=?', session.eventId, g.id); return { id: g.id, name: g.name, ...(b ? { band: b.shortCode } : {}), inside: b ? inside(b.token) : false, ...(g.over21 === null ? {} : { over21: Boolean(g.over21) }) }; });
      audit(session.eventId, session.name, 'guest_lookup', { query: q }); return json(res, 200, result);
    }
    if (method === 'POST' && p === '/api/scan') {
      const session = monitor(req, url), idem = idempotency(req, res, session.eventId); if (idem.replayed) return;
      const b = await body(req); rate(`scan:${session.token}`, 3000, 60_000);
      if (!['in', 'out'].includes(b.direction) || (!text(b.bandToken, 200) && !text(b.shortCode, 4))) throw fail(400, 'invalid_scan');
      let timestamp = at();
      if (b.at !== undefined) {
        const clientTime = Date.parse(b.at);
        if (typeof b.at !== 'string' || !Number.isFinite(clientTime) || Math.abs(clientTime - Date.parse(timestamp)) > 12 * 3_600_000) throw fail(400, 'invalid_scan_time');
        timestamp = new Date(clientTime).toISOString();
      }
      const band = bandFor(session, b.bandToken || b.shortCode, !b.bandToken), previous = lastScan(band.token);
      if (b.direction === 'in' && !band.guestId && !b.guestId) return idem.respond(200, { needsGuest: true, band: { shortCode: band.shortCode } });
      if (!band.guestId && b.direction === 'out') throw fail(409, 'unlinked_band');
      if (band.guestId && b.guestId && !secureEqual(band.guestId, b.guestId)) throw fail(409, 'band_already_linked');
      if (!band.guestId) {
        const g = one('SELECT id FROM guests WHERE id=? AND eventId=?', b.guestId, session.eventId);
        if (!g) throw fail(404, 'guest_not_found');
        if (one('SELECT token FROM bands WHERE eventId=? AND guestId=?', session.eventId, g.id)) throw fail(409, 'guest_already_linked');
        run('UPDATE bands SET guestId=? WHERE token=? AND guestId IS NULL', g.id, band.token); band.guestId = g.id;
      }
      const guest = one('SELECT id,name FROM guests WHERE id=?', band.guestId);
      const warning = (b.direction === 'in' && previous?.direction === 'in') ? 'already_inside' : (b.direction === 'out' && previous?.direction !== 'in') ? 'not_inside' : undefined;
      if (!warning) { run('INSERT INTO scans (id,eventId,bandToken,guestId,direction,at,monitorName) VALUES (?,?,?,?,?,?,?)', randomToken(), session.eventId, band.token, guest.id, b.direction, timestamp, session.name); emit(session.eventId, 'scan', { guest: guestPublic(guest), band: band.shortCode, direction: b.direction, at: timestamp }); emitStats(session.eventId); }
      return idem.respond(200, { guest: guestPublic(guest), inside: warning ? previous?.direction === 'in' : b.direction === 'in', at: timestamp, ...(warning ? { warning } : {}) });
    }
    if (method === 'POST' && p === '/api/departures') {
      const session = monitor(req, url), idem = idempotency(req, res, session.eventId); if (idem.replayed) return;
      const b = await body(req);
      const values = Array.isArray(b.bandTokens) ? b.bandTokens : b.shortCodes, byCode = !Array.isArray(b.bandTokens);
      if (!Array.isArray(values) || !values.length || values.length > 30 || values.some(v => !text(v, 200))) throw fail(400, 'invalid_departure');
      const bands = values.map(v => bandFor(session, v, byCode));
      if (new Set(bands.map(x => x.token)).size !== bands.length) throw fail(400, 'duplicate_band');
      if (bands.some(x => !x.guestId)) throw fail(409, 'unlinked_band');
      const people = bands.map(x => guestPublic(one('SELECT id,name FROM guests WHERE id=?', x.guestId)));
      const groupId = randomToken(), timestamp = at();
      db.exec('BEGIN IMMEDIATE'); try {
        for (const band of bands) {
          if (inside(band.token)) run('INSERT INTO scans (id,eventId,bandToken,guestId,direction,at,monitorName) VALUES (?,?,?,?,?,?,?)', randomToken(), session.eventId, band.token, band.guestId, 'out', timestamp, session.name);
          run('INSERT INTO departures (id,eventId,groupId,guestId,bandToken,at) VALUES (?,?,?,?,?,?)', randomToken(), session.eventId, groupId, band.guestId, band.token, timestamp);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      emit(session.eventId, 'departure', { groupId, at: timestamp, people }); emitStats(session.eventId);
      return idem.respond(200, { groupId, people: people.map(p => ({ name: p.name })) });
    }
    if (method === 'GET' && p === '/api/dashboard') {
      const session = monitor(req, url), e = event(session.eventId);
      const guests = many('SELECT id,name FROM guests WHERE eventId=? ORDER BY name,id', e.id), bands = many('SELECT token,shortCode,guestId FROM bands WHERE eventId=?', e.id);
      const scans = many('SELECT bandToken,guestId,direction,at FROM scans WHERE eventId=? ORDER BY at,id', e.id), deps = many('SELECT groupId,guestId,at FROM departures WHERE eventId=? ORDER BY at,id', e.id);
      const bandByGuest = new Map(bands.filter(b => b.guestId).map(b => [b.guestId, b]));
      const groupPeople = new Map(); for (const d of deps) { if (!groupPeople.has(d.groupId)) groupPeople.set(d.groupId, []); groupPeople.get(d.groupId).push(d.guestId); }
      const names = new Map(guests.map(g => [g.id, g.name]));
      const roster = guests.map(g => {
        const band = bandByGuest.get(g.id), gs = scans.filter(s => s.guestId === g.id), last = gs.at(-1), dep = deps.filter(d => d.guestId === g.id).at(-1);
        const status = last?.direction === 'in' ? 'inside' : last ? 'left' : 'not_arrived';
        const mates = dep ? groupPeople.get(dep.groupId).filter(id => id !== g.id).map(id => names.get(id)).filter(Boolean) : [];
        return { name: g.name, band: band?.shortCode || null, status, ...(gs.find(s => s.direction === 'in') ? { inAt: gs.find(s => s.direction === 'in').at } : {}), ...(last?.direction === 'out' ? { outAt: last.at } : {}), ...(dep ? { leftWith: mates } : {}) };
      });
      const recentDepartures = [...groupPeople].map(([groupId, ids]) => ({ at: deps.find(d => d.groupId === groupId).at, people: ids.map(id => names.get(id)).filter(Boolean) })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
      audit(e.id, session.name, 'dashboard_lookup');
      const s = counts(e.id); return json(res, 200, { event: { id: e.id, name: e.name, capacity: e.capacity }, inside: s.inside, checkedIn: s.checkedIn, left: s.left, roster, recentDepartures });
    }
    if (method === 'GET' && p === '/api/dashboard/stream') {
      const session = monitor(req, url, true);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write(': connected\n\n');
      if (!streams.has(session.eventId)) streams.set(session.eventId, new Set()); streams.get(session.eventId).add(res);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000); heartbeat.unref?.();
      req.on('close', () => { clearInterval(heartbeat); streams.get(session.eventId)?.delete(res); }); return;
    }
    throw fail(404, 'not_found');
  }

  async function staticFile(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'method_not_allowed');
    const p = decodeURIComponent(url.pathname);
    const tap = p.match(/^\/t\/([^/]+)$/);
    if (tap) {
      const band = one('SELECT eventId FROM bands WHERE token=?', tap[1]);
      const cookie = req.headers.cookie?.match(/(?:^|;\s*)hb_monitor=([0-9a-f]{32})/)?.[1];
      const session = cookie && one('SELECT eventId FROM monitor_sessions WHERE token=?', cookie);
      if (band && session?.eventId === band.eventId) { res.writeHead(302, { Location: `/door?bandToken=${encodeURIComponent(tap[1])}`, 'Cache-Control': 'no-store' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? '' : '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homebound band</title><h1>This is a Homebound safety band</h1></html>');
    }
    let relative = p === '/' ? 'admin/index.html' : ['/door', '/dashboard', '/admin'].includes(p) ? `${p.slice(1)}/index.html` : p.slice(1);
    const full = path.resolve(webRoot, relative);
    if (!full.startsWith(webRoot + path.sep)) throw fail(403, 'forbidden');
    let info; try { info = await stat(full); } catch { throw fail(404, 'not_found'); }
    if (info.isDirectory()) return staticFile(req, res, new URL(`${p.replace(/\/$/, '')}/index.html`, url));
    if (!info.isFile()) throw fail(404, 'not_found');
    res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(full));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    try { const url = new URL(req.url, 'http://localhost'); if (url.pathname.startsWith('/api/')) await api(req, res, url); else await staticFile(req, res, url); }
    catch (error) { if (res.headersSent) return res.destroy(); if (!error.status) console.error(error); json(res, error.status || 500, { error: error.error || 'internal_error', message: error.status ? error.message : 'Internal server error' }); }
  });
  if (startJobs) { server.on('listening', jobs.start); server.on('close', jobs.stop); }
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(); server.listen(Number(process.env.PORT) || 4400, () => console.log(`Homebound listening on ${server.address().port}`));
}
