// web/shared/api.js - Client API module for Homebound v2

const STORAGE_KEYS = {
  MONITOR_TOKEN: 'hb_monitor_token',
  MONITOR_EVENT_ID: 'hb_monitor_event_id',
  MONITOR_EVENT_NAME: 'hb_monitor_event_name',
  MONITOR_NAME: 'hb_monitor_name',
  ADMIN_EVENT_ID: 'hb_admin_event_id',
  ADMIN_PIN: 'hb_admin_pin',
  ADMIN_MONITOR_CODE: 'hb_admin_monitor_code',
};

class ApiError extends Error {
  constructor(status, error, message) {
    super(message || error || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
  }
}

/**
 * Universal fetch wrapper with JSON parsing and clean error reporting.
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

// --- Session & Credential Storage ---

export function getMonitorToken() {
  return localStorage.getItem(STORAGE_KEYS.MONITOR_TOKEN) || null;
}

export function getMonitorSession() {
  const token = getMonitorToken();
  if (!token) return null;
  return {
    token,
    eventId: localStorage.getItem(STORAGE_KEYS.MONITOR_EVENT_ID),
    eventName: localStorage.getItem(STORAGE_KEYS.MONITOR_EVENT_NAME),
    name: localStorage.getItem(STORAGE_KEYS.MONITOR_NAME),
  };
}

export function saveMonitorSession({ token, eventId, eventName, name }) {
  if (token) localStorage.setItem(STORAGE_KEYS.MONITOR_TOKEN, token);
  if (eventId) localStorage.setItem(STORAGE_KEYS.MONITOR_EVENT_ID, eventId);
  if (eventName) localStorage.setItem(STORAGE_KEYS.MONITOR_EVENT_NAME, eventName);
  if (name) localStorage.setItem(STORAGE_KEYS.MONITOR_NAME, name);
}

export function clearMonitorSession() {
  localStorage.removeItem(STORAGE_KEYS.MONITOR_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.MONITOR_EVENT_ID);
  localStorage.removeItem(STORAGE_KEYS.MONITOR_EVENT_NAME);
  localStorage.removeItem(STORAGE_KEYS.MONITOR_NAME);
}

export function getAdminPin() {
  return localStorage.getItem(STORAGE_KEYS.ADMIN_PIN) || null;
}

export function getAdminSession() {
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
  if (eventId) localStorage.setItem(STORAGE_KEYS.ADMIN_EVENT_ID, eventId);
  if (adminPin) localStorage.setItem(STORAGE_KEYS.ADMIN_PIN, adminPin);
  if (monitorCode) localStorage.setItem(STORAGE_KEYS.ADMIN_MONITOR_CODE, monitorCode);
}

export function clearAdminSession() {
  localStorage.removeItem(STORAGE_KEYS.ADMIN_PIN);
  localStorage.removeItem(STORAGE_KEYS.ADMIN_EVENT_ID);
  localStorage.removeItem(STORAGE_KEYS.ADMIN_MONITOR_CODE);
}

// --- Monitor API Methods ---

/**
 * Join event as a monitor: POST /api/events/:id/monitor-session
 */
export async function joinMonitor(eventId, { monitorCode, name }) {
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
 * Search guests by name: GET /api/guests?q=...
 */
export async function searchGuests(q = '') {
  return request(`/api/guests?q=${encodeURIComponent(q.trim())}`);
}

/**
 * Scan band at door: POST /api/scan
 * { bandToken?, shortCode?, direction: 'in' | 'out', guestId? }
 */
export async function scanBand({ bandToken, shortCode, direction, guestId }) {
  const payload = { direction };
  if (bandToken) payload.bandToken = bandToken;
  if (shortCode) payload.shortCode = shortCode.toUpperCase();
  if (guestId) payload.guestId = guestId;

  return request('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Record departure (solo or together): POST /api/departures
 * { bandTokens?: string[], shortCodes?: string[] }
 */
export async function recordDepartures({ bandTokens, shortCodes }) {
  const payload = {};
  if (bandTokens && bandTokens.length) payload.bandTokens = bandTokens;
  else if (shortCodes && shortCodes.length) payload.shortCodes = shortCodes.map(s => s.toUpperCase());

  return request('/api/departures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Get dashboard snapshot: GET /api/dashboard
 */
export async function getDashboard() {
  return request('/api/dashboard');
}

/**
 * Connect to SSE live stream: GET /api/dashboard/stream?token=...
 */
export function openDashboardStream({ onStats, onScan, onDeparture, onError }) {
  const token = getMonitorToken();
  if (!token) throw new Error('Monitor token required for live stream');

  const streamUrl = `/api/dashboard/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(streamUrl);

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
 * Add walk-in guest: POST /api/events/:id/guests
 */
export async function addWalkInGuest(eventId, { name, email, phone }) {
  const payload = { name: name.trim() };
  if (email && email.trim()) payload.email = email.trim();
  if (phone && phone.trim()) payload.phone = phone.trim();

  return request(`/api/events/${encodeURIComponent(eventId)}/guests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// --- Organizer / Admin API Methods ---

/**
 * Create a new event: POST /api/events
 * Returns { eventId, adminPin, monitorCode }
 */
export async function createEvent({ name, startsAt, endsAt }) {
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
 * Get event details and stats: GET /api/events/:id
 */
export async function getEvent(eventId, adminPin = null) {
  const headers = {};
  const pin = adminPin || getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}`, { headers });
}

/**
 * Import guests from Luma API: POST /api/events/:id/import/luma
 */
export async function importLuma(eventId, { apiKey, lumaEventId }) {
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
 * Import guests from Partiful / Luma CSV: POST /api/events/:id/import/csv
 */
export async function importCsv(eventId, csvContent) {
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
 * Generate wristband tags: POST /api/events/:id/bands
 */
export async function generateBands(eventId, count) {
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
 * Download bands CSV for NFC tags: GET /api/events/:id/bands.csv
 */
export async function getBandsCsv(eventId) {
  const headers = {};
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/bands.csv`, { headers });
}

/**
 * Download full roster export: GET /api/events/:id/export.csv
 */
export async function getExportCsv(eventId) {
  const headers = {};
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/export.csv`, { headers });
}

/**
 * End event now: POST /api/events/:id/end
 */
export async function endEvent(eventId) {
  const headers = {};
  const pin = getAdminPin();
  if (pin) headers['X-Admin-Pin'] = pin;

  return request(`/api/events/${encodeURIComponent(eventId)}/end`, {
    method: 'POST',
    headers,
  });
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
