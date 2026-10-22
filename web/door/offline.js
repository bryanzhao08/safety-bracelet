// web/door/offline.js - Offline scan & departure queue with IndexedDB & exponential backoff

const DB_NAME = 'hb_door_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'queue';
const TIMEOUT_MS = 4000;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

let dbPromise = null;
let isFlushing = false;
let currentBackoff = INITIAL_BACKOFF_MS;
let retryTimer = null;
const statusListeners = new Set();

/**
 * Open or upgrade the IndexedDB database.
 */
function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Enqueue an action into IndexedDB.
 */
export async function enqueueAction({ id, type, payload, clientTimestamp, token }) {
  const db = await openDb();
  const entry = {
    id: id || crypto.randomUUID(),
    type, // 'scan' | 'departure'
    payload,
    clientTimestamp: clientTimestamp || new Date().toISOString(),
    token: token || null,
    createdAt: Date.now(),
    retryCount: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(entry);

    req.onsuccess = () => {
      notifyListeners();
      scheduleRetry(INITIAL_BACKOFF_MS);
      resolve(entry);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all queued items sorted by createdAt ascending (FIFO).
 */
export async function getQueuedActions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const req = index.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get count of pending actions.
 */
export async function getQueuedCount() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.count();

    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove an item from the queue by ID.
 */
export async function removeAction(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => {
      notifyListeners();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Subscribe to queue status changes.
 */
export function onQueueChange(callback) {
  statusListeners.add(callback);
  // Initial fire
  getQueuedCount().then((count) => {
    callback({ count, isSyncing: isFlushing, isOnline: navigator.onLine });
  });
  return () => statusListeners.delete(callback);
}

async function notifyListeners() {
  try {
    const count = await getQueuedCount();
    for (const listener of statusListeners) {
      try {
        listener({ count, isSyncing: isFlushing, isOnline: navigator.onLine });
      } catch (e) {
        console.warn('Listener error in offline queue', e);
      }
    }
  } catch (err) {
    console.warn('Failed to notify queue listeners', err);
  }
}

/**
 * Send request with a 4-second timeout and client Idempotency-Key.
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Execute scan now or queue if offline / timed out (> 4s).
 * Sends client UUID in Idempotency-Key.
 */
export async function executeOrQueueScan(payload, monitorToken) {
  const id = crypto.randomUUID();
  const clientTimestamp = new Date().toISOString();

  // If already known to be offline, enqueue directly without waiting
  if (!navigator.onLine) {
    const entry = await enqueueAction({
      id,
      type: 'scan',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry };
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Idempotency-Key': id,
      'X-Client-Timestamp': clientTimestamp,
    };
    if (monitorToken) {
      headers['Authorization'] = `Bearer ${monitorToken}`;
    }

    const response = await fetchWithTimeout('/api/scan', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (response.ok) {
      return { queued: false, data, status: response.status };
    }

    // 4xx errors are client/validation errors (e.g. 409 already linked, needsGuest).
    // They must not be queued as offline retries.
    if (response.status >= 400 && response.status < 500) {
      return {
        queued: false,
        error: data?.error || 'client_error',
        message: data?.message || `HTTP ${response.status}`,
        data,
        status: response.status,
      };
    }

    // 5xx server error: queue for retry
    const entry = await enqueueAction({
      id,
      type: 'scan',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry, serverError: true };
  } catch (err) {
    // Network error or timeout over 4s
    const entry = await enqueueAction({
      id,
      type: 'scan',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry, timeout: err.name === 'AbortError' };
  }
}

/**
 * Execute departure now or queue if offline / timed out (> 4s).
 * Sends client UUID in Idempotency-Key.
 */
export async function executeOrQueueDeparture(payload, monitorToken) {
  const id = crypto.randomUUID();
  const clientTimestamp = new Date().toISOString();

  if (!navigator.onLine) {
    const entry = await enqueueAction({
      id,
      type: 'departure',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry };
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Idempotency-Key': id,
      'X-Client-Timestamp': clientTimestamp,
    };
    if (monitorToken) {
      headers['Authorization'] = `Bearer ${monitorToken}`;
    }

    const response = await fetchWithTimeout('/api/departures', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (response.ok) {
      return { queued: false, data, status: response.status };
    }

    if (response.status >= 400 && response.status < 500) {
      return {
        queued: false,
        error: data?.error || 'client_error',
        message: data?.message || `HTTP ${response.status}`,
        data,
        status: response.status,
      };
    }

    // 5xx error -> queue
    const entry = await enqueueAction({
      id,
      type: 'departure',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry, serverError: true };
  } catch (err) {
    // Network failure or timeout
    const entry = await enqueueAction({
      id,
      type: 'departure',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry, timeout: err.name === 'AbortError' };
  }
}

/**
 * Flush all queued items in order with exponential backoff.
 */
export async function flushQueue() {
  if (isFlushing || !navigator.onLine) return;

  const items = await getQueuedActions();
  if (items.length === 0) {
    currentBackoff = INITIAL_BACKOFF_MS;
    notifyListeners();
    return;
  }

  isFlushing = true;
  notifyListeners();

  for (const item of items) {
    if (!navigator.onLine) break;

    const endpoint = item.type === 'scan' ? '/api/scan' : '/api/departures';
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Idempotency-Key': item.id,
      'X-Client-Timestamp': item.clientTimestamp,
    };
    if (item.token) {
      headers['Authorization'] = `Bearer ${item.token}`;
    }

    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(item.payload),
      });

      // Status 200..299 or 409 (duplicate / already linked) means server processed/acknowledged it
      if (response.ok || response.status === 409) {
        await removeAction(item.id);
        currentBackoff = INITIAL_BACKOFF_MS; // reset backoff on success
      } else if (response.status >= 400 && response.status < 500) {
        // Unretryable bad request / auth error
        console.warn('Dropping invalid queued action', item.id, response.status);
        await removeAction(item.id);
      } else {
        // 5xx error: abort batch and schedule next retry
        throw new Error(`Server returned status ${response.status}`);
      }
    } catch (err) {
      console.warn('Queue flush paused on error for item', item.id, err);
      scheduleRetry(currentBackoff);
      currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF_MS);
      break;
    }
  }

  isFlushing = false;
  notifyListeners();
}

function scheduleRetry(delay) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushQueue();
  }, delay);
}

/**
 * Initialize queue listeners and periodic sync.
 */
export function initOfflineQueue() {
  // Listen for online events
  window.addEventListener('online', () => {
    currentBackoff = INITIAL_BACKOFF_MS;
    flushQueue();
  });

  window.addEventListener('offline', () => {
    notifyListeners();
  });

  // Background check every 10 seconds if online
  setInterval(() => {
    if (navigator.onLine && !isFlushing) {
      getQueuedCount().then((count) => {
        if (count > 0) flushQueue();
      });
    }
  }, 10000);

  // Initial flush if online
  if (navigator.onLine) {
    flushQueue();
  } else {
    notifyListeners();
  }
}
