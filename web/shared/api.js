// web/shared/api.js - Client API module for Homebound v2 (Server & Sheets modes)

import { getBackend, PILOT_SHEET_URL } from './config.js';

const STORAGE_KEYS = {
  MONITOR_TOKEN: 'hb_monitor_token',
  MONITOR_EVENT_ID: 'hb_monitor_event_id',
  MONITOR_EVENT_NAME: 'hb_monitor_event_name',
  MONITOR_NAME: 'hb_monitor_name',
  ADMIN_EVENT_ID: 'hb_admin_event_id',
  ADMIN_PIN: 'hb_admin_pin',
  ADMIN_MONITOR_CODE: 'hb_admin_monitor_code',
};

export class ApiError extends Error {
  constructor(status, error, message) {
    super(message || error || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
  }
}

/**
 * Universal fetch wrapper for Node server mode with JSON parsing and clean error reporting.
 */
async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  // Auto-attach monitor bearer token if present and not overridden
  const monitorToken = getMonitorToken();
  if (monitorToken && !headers.has('Authorization') && !headers.has('X-Admin-Pin')) {
    headers.set('Authorization', `Bearer ${monitorToken}`);
  }

  // Auto-attach admin PIN if available and no monitor token or explicit admin request
  const adminPin = getAdminPin();
  if (adminPin && !headers.has('X-Admin-Pin') && !headers.has('Authorization')) {
    headers.set('X-Admin-Pin', adminPin);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  let data;

  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    data = await response.text();
  }

  if (!response.ok) {
    const errorKey = data?.error || 'network_error';
    const message = data?.message || data?.error || response.statusText;
    throw new ApiError(response.status, errorKey, message);
  }

  return data;
}

/**
 * Universal caller for Google Sheets backend mode.
 * Uses text/plain POST to avoid CORS preflight while sending JSON.
 */
async function sheetsCall(action, args = {}) {
  const backend = getBackend();
  if (backend.type !== 'sheets' || !backend.url) {
    throw new ApiError(400, 'sheets_not_configured', 'Google Sheet URL not configured. Visit /setup/ to connect a sheet.');
  }

  const auth = {};
  const monitorToken = getMonitorToken();
  if (monitorToken) auth.monitorToken = monitorToken;
  const adminPin = getAdminPin();
  if (adminPin) auth.adminPin = adminPin;

  // Include requestId for Apps Script idempotency caching
  const requestId = args.requestId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  const payload = {
    action,
    auth,
    requestId,
    ...args,
  };

  const response = await fetch(backend.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(response.status || 500, 'invalid_response', 'Invalid response from Google Sheets');
  }

  if (data && (data.error || (data.status && data.status >= 400))) {
    const status = data.status || 400;
    const error = data.error || 'error';
    const message = data.message || data.error || 'Sheets request failed';
    throw new ApiError(status, error, message);
  }

  return data;
}

// --- Session & Credential Storage ---

export function getMonitorToken() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEYS.MONITOR_TOKEN) || null;
}

export function getMonitorSession() {
  const token = getMonitorToken();
  if (!token || typeof localStorage === 'undefined') return null;
  return {
    token,
    eventId: localStorage.getItem(STORAGE_KEYS.MONITOR_EVENT_ID),
    eventName: localStorage.getItem(STORAGE_KEYS.MONITOR_EVENT_NAME),
    name: localStorage.getItem(STORAGE_KEYS.MONITOR_NAME),
  };
}

export function saveMonitorSession({ token, eventId, eventName, name }) {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(STORAGE_KEYS.MONITOR_TOKEN, token);
  if (eventId) localStorage.setItem(STORAGE_KEYS.MONITOR_EVENT_ID, eventId);
  if (eventName) localStorage.setItem(STORAGE_KEYS.MONITOR_EVENT_NAME, eventName);
  if (name) localStorage.setItem(STORAGE_KEYS.MONITOR_NAME, name);
}

export function clearMonitorSession() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.MONITOR_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.MONITOR_EVENT_ID);
  localStorage.removeItem(STORAGE_KEYS.MONITOR_EVENT_NAME);
  localStorage.removeItem(STORAGE_KEYS.MONITOR_NAME);
}

export function getAdminPin() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEYS.ADMIN_PIN) || null;
}

export function getAdminSession() {
  if (typeof localStorage === 'undefined') return null;
  const pin = getAdminPin();
  const eventId = localStorage.getItem(STORAGE_KEYS.ADMIN_EVENT_ID);
  if (!pin || !eventId) return null;
  return {
    pin,
    eventId,
    monitorCode: localStorage.getItem(STORAGE_KEYS.ADMIN_MONITOR_CODE),
  };
}

export function saveAdminSession({ eventId, adminPin, monitorCode }) {
  if (typeof localStorage === 'undefined') return;
  if (eventId) localStorage.setItem(STORAGE_KEYS.ADMIN_EVENT_ID, eventId);
  if (adminPin) localStorage.setItem(STORAGE_KEYS.ADMIN_PIN, adminPin);
  if (monitorCode) localStorage.setItem(STORAGE_KEYS.ADMIN_MONITOR_CODE, monitorCode);
}

export function clearAdminSession() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.ADMIN_PIN);
  localStorage.removeItem(STORAGE_KEYS.ADMIN_EVENT_ID);
  localStorage.removeItem(STORAGE_KEYS.ADMIN_MONITOR_CODE);
}

// --- Monitor API Methods ---

/**
 * Join event as a monitor: POST /api/events/:id/monitor-session or action 'monitorSession'
 */
export async function joinMonitor(eventId, { monitorCode, name }) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    const res = await sheetsCall('monitorSession', { monitorCode, name });
    saveMonitorSession({
      token: res.monitorToken,
      eventId: res.event?.id || eventId || 'sheet_event',
      eventName: res.event?.name || '',
      name: name.trim(),
    });
    return res;
  }

  const res = await request(`/api/events/${encodeURIComponent(eventId)}/monitor-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monitorCode, name }),
  });
  saveMonitorSession({
    token: res.monitorToken,
    eventId: res.event?.id || eventId,
    eventName: res.event?.name || '',
    name: name.trim(),
  });
  return res;
}

/**
 * Search guests by name: GET /api/guests?q=... or action 'searchGuests'
 */
export async function searchGuests(q = '') {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('searchGuests', { q: (q || '').trim() });
  }
  return request(`/api/guests?q=${encodeURIComponent(q.trim())}`);
}

/**
 * ID check-in: POST /api/id-checkin or action 'idCheckin'
 * Sends minimal AAMVA fields for age check and guest match.
 */
export async function idCheckin({ firstName, lastName, dob, idState, idExpires, licenseNumber }) {
  const payload = {
    firstName: firstName || null,
    lastName: lastName || null,
    dob: dob || null,
    idState: idState || null,
    idExpires: idExpires || null,
    licenseNumber: licenseNumber || null,
  };

  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('idCheckin', payload);
  }

  return request('/api/id-checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Scan band at door: POST /api/scan or action 'scan'
 */
export async function scanBand({ bandToken, shortCode, direction, guestId }) {
  const payload = { direction };
  if (bandToken) payload.bandToken = bandToken;
  if (shortCode) payload.shortCode = shortCode.toUpperCase();
  if (guestId) payload.guestId = guestId;

  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('scan', payload);
  }

  return request('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Record departure (solo or together): POST /api/departures or action 'departures'
 */
export async function recordDepartures({ bandTokens, shortCodes }) {
  const payload = {};
  if (bandTokens && bandTokens.length) payload.bandTokens = bandTokens;
  else if (shortCodes && shortCodes.length) payload.shortCodes = shortCodes.map(s => s.toUpperCase());

  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('departures', payload);
  }

  return request('/api/departures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Get dashboard snapshot: GET /api/dashboard or action 'dashboard'
 */
export async function getDashboard() {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('dashboard');
  }
  return request('/api/dashboard');
}

/**
 * Connect to dashboard live stream.
 * Server mode: EventSource SSE.
 * Sheets mode: Polling dashboard every 5s with synthesized scan and departure events.
 */
export function openDashboardStream({ onStats, onScan, onDeparture, onError, onOpen }) {
  const backend = getBackend();

  if (backend.type === 'sheets') {
    let closed = false;
    let interval = null;
    let lastRosterStatus = new Map();
    let seenDepartures = new Set();
    let isFirstPoll = true;

    async function poll() {
      if (closed) return;
      try {
        const data = await getDashboard();
        if (closed) return;

        if (isFirstPoll) {
          isFirstPoll = false;
          onOpen?.();
          if (data.recentDepartures) {
            for (const dep of data.recentDepartures) {
              seenDepartures.add(`${dep.at}|${(dep.people || []).join(',')}`);
            }
          }
          if (data.roster) {
            for (const r of data.roster) {
              lastRosterStatus.set(r.name, r.status);
            }
          }
          onStats?.({
            inside: data.inside,
            checkedIn: data.checkedIn,
            left: data.left,
          });
          return;
        }

        onStats?.({
          inside: data.inside,
          checkedIn: data.checkedIn,
          left: data.left,
        });

        // Synthesize departure events
        if (data.recentDepartures) {
          for (const dep of data.recentDepartures) {
            const key = `${dep.at}|${(dep.people || []).join(',')}`;
            if (!seenDepartures.has(key)) {
              seenDepartures.add(key);
              onDeparture?.(dep);
            }
          }
        }

        // Synthesize scan events from roster transitions
        if (data.roster) {
          for (const r of data.roster) {
            const prev = lastRosterStatus.get(r.name);
            if (prev && prev !== r.status) {
              if (r.status === 'inside') {
                onScan?.({
                  guest: { name: r.name },
                  band: r.band,
                  direction: 'in',
                  at: r.inAt || new Date().toISOString(),
                });
              } else if (r.status === 'left') {
                onScan?.({
                  guest: { name: r.name },
                  band: r.band,
                  direction: 'out',
                  at: r.outAt || new Date().toISOString(),
                });
              }
            }
            lastRosterStatus.set(r.name, r.status);
          }
        }
      } catch (err) {
        if (!closed) onError?.(err);
      }
    }

    poll();
    interval = setInterval(poll, 5000);

    return {
      close() {
        closed = true;
        if (interval) clearInterval(interval);
      },
    };
  }

  const token = getMonitorToken();
  if (!token) throw new Error('Monitor token required for live stream');

  const streamUrl = `/api/dashboard/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(streamUrl);

  es.onopen = (e) => {
    onOpen?.(e);
  };

  es.addEventListener('stats', (e) => {
    try {
      const data = JSON.parse(e.data);
      onStats?.(data);
    } catch (err) {
      console.error('Failed to parse stats event', err);
    }
  });

  es.addEventListener('scan', (e) => {
    try {
      const data = JSON.parse(e.data);
      onScan?.(data);
    } catch (err) {
      console.error('Failed to parse scan event', err);
    }
  });

  es.addEventListener('departure', (e) => {
    try {
      const data = JSON.parse(e.data);
      onDeparture?.(data);
    } catch (err) {
      console.error('Failed to parse departure event', err);
    }
  });

  es.onerror = (err) => {
    onError?.(err);
  };

  return es;
}

/**
 * Add walk-in guest: POST /api/events/:id/guests or action 'addGuest'
 */
export async function addWalkInGuest(eventId, { name, email, phone }) {
  const payload = { name: name.trim() };
  if (email && email.trim()) payload.email = email.trim();
  if (phone && phone.trim()) payload.phone = phone.trim();

  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('addGuest', payload);
  }

  return request(`/api/events/${encodeURIComponent(eventId)}/guests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// --- Organizer / Admin API Methods ---

/**
 * Create a new event: POST /api/events
 */
export async function createEvent({ name, startsAt, endsAt }) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    throw new ApiError(
      400,
      'use_sheet_setup',
      'Google Sheet events are created via Apps Script setup. Visit /setup/ to connect your sheet.'
    );
  }

  const res = await request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name.trim(),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    }),
  });
  saveAdminSession({
    eventId: res.eventId,
    adminPin: res.adminPin,
    monitorCode: res.monitorCode,
  });
  return res;
}

/**
 * Get event details and stats: GET /api/events/:id or action 'event'
 */
export async function getEvent(eventId, adminPin = null) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    const pin = adminPin || getAdminPin();
    return sheetsCall('event', pin ? { auth: { adminPin: pin } } : {});
  }

  const headers = {};
  const pin = adminPin || getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}`, { headers });
}

/**
 * Import guests from Luma API: POST /api/events/:id/import/luma
 */
export async function importLuma(eventId, { apiKey, lumaEventId }) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    throw new ApiError(
      400,
      'unsupported_in_sheets',
      'Luma API direct sync requires the Node server. Please export CSV from Luma and use CSV import.'
    );
  }

  const headers = { 'Content-Type': 'application/json' };
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/import/luma`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      apiKey: apiKey.trim(),
      lumaEventId: lumaEventId.trim(),
    }),
  });
}

/**
 * Import guests from Partiful / Luma CSV: POST /api/events/:id/import/csv or action 'importCsv'
 */
export async function importCsv(eventId, csvContent) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('importCsv', { csvContent });
  }

  const headers = { 'Content-Type': 'text/csv; charset=utf-8' };
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/import/csv`, {
    method: 'POST',
    headers,
    body: csvContent,
  });
}

/**
 * Generate wristband tags: POST /api/events/:id/bands or action 'createBands'
 */
export async function generateBands(eventId, count) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    const siteUrl = typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname.replace(/\/admin\/.*$|\/setup\/.*$/, '')}`
      : undefined;
    return sheetsCall('createBands', { count: Number(count), siteUrl });
  }

  const headers = { 'Content-Type': 'application/json' };
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/bands`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ count: Number(count) }),
  });
}

/**
 * Download bands CSV: GET /api/events/:id/bands.csv or action 'bandsCsv'
 */
export async function getBandsCsv(eventId) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    const res = await sheetsCall('bandsCsv');
    return res.csv || res;
  }

  const headers = {};
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/bands.csv`, { headers });
}

/**
 * Download full roster export: GET /api/events/:id/export.csv or action 'exportCsv'
 */
export async function getExportCsv(eventId) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    const res = await sheetsCall('exportCsv');
    return res.csv || res;
  }

  const headers = {};
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/export.csv`, { headers });
}

/**
 * End event now: POST /api/events/:id/end or action 'endEvent'
 */
export async function endEvent(eventId) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('endEvent');
  }

  const headers = {};
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/end`, {
    method: 'POST',
    headers,
  });
}

/**
 * Incident timeline for a guest: GET /api/events/:id/guests/:guestId/timeline or action 'timeline'
 */
export async function getGuestTimeline(eventId, guestId) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('timeline', { guestId });
  }

  const headers = {};
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/guests/${encodeURIComponent(guestId)}/timeline`, { headers });
}

/**
 * Update event settings (e.g. capacity): PATCH /api/events/:id or action 'updateEvent'
 */
export async function updateEvent(eventId, updates = {}) {
  const backend = getBackend();
  if (backend.type === 'sheets') {
    return sheetsCall('updateEvent', updates);
  }

  const headers = { 'Content-Type': 'application/json' };
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates),
  });
}

/**
 * Submit pilot program signup: POST /api/pilot
 */
export async function submitPilot({ chapter, school, email, eventSize, note }) {
  if (getBackend().type === 'sheets') {
    if (!PILOT_SHEET_URL) {
      throw new ApiError(503, 'pilot_not_connected', 'Pilot sign-ups are not connected on this site yet.');
    }
    const response = await fetch(PILOT_SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'pilot', chapter, school, email, eventSize: eventSize ?? null, note: note || null }),
    });
    const data = await response.json().catch(() => null);
    if (!data || data.error) {
      throw new ApiError(data?.status || 500, data?.error || 'invalid_response', data?.message || 'Pilot request failed');
    }
    return data;
  }
  return request('/api/pilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chapter: chapter?.trim(),
      school: school?.trim(),
      email: email?.trim(),
      eventSize: eventSize ?? null,
      note: note?.trim() || null,
    }),
  });
}

/**
 * Capacity helpers (persisted on event if server supports it, otherwise localStorage)
 */
export function getEventCapacity(eventId) {
  if (!eventId || typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(`hb_capacity_${eventId}`);
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function saveEventCapacity(eventId, capacity) {
  if (!eventId || typeof localStorage === 'undefined') return;
  const parsed = parseInt(capacity, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    localStorage.setItem(`hb_capacity_${eventId}`, String(parsed));
  } else {
    localStorage.removeItem(`hb_capacity_${eventId}`);
  }
}

// --- Formatters & Helpers ---

export function formatTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  } catch {
    return isoString;
  }
}

export function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return isoString;
  }
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    return `${date} · ${time}`;
  } catch {
    return isoString;
  }
}
