// web/door/offline.js - Offline scan & departure queue with IndexedDB & exponential backoff
import * as api from '../shared/api.js';

const DB_NAME = 'homebound_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_actions';

const TIMEOUT_MS = 4000;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

let dbPromise = null;
let currentBackoff = INITIAL_BACKOFF_MS;
let isFlushing = false;
let retryTimerId = null;

const queueListeners = new Set();

export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

export async function enqueueAction({ id, type, payload, clientTimestamp, token }) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = {
      id: id || generateUUID(),
      type,
      payload,
      clientTimestamp: clientTimestamp || new Date().toISOString(),
      token: token || null,
      createdAt: Date.now(),
      retryCount: 0,
    };
    const req = store.add(entry);
    req.onsuccess = () => {
      notifyQueueChanged();
      resolve(entry);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueue() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const req = index.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getQueueCount() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromQueue(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => {
      notifyQueueChanged();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function onQueueChange(callback) {
  queueListeners.add(callback);
  getQueueCount().then((count) => {
    try {
      callback({ count, isSyncing: isFlushing });
    } catch {}
  });
  return () => queueListeners.delete(callback);
}

async function notifyQueueChanged() {
  try {
    const count = await getQueueCount();
    for (const listener of queueListeners) {
      try {
        listener({ count, isSyncing: isFlushing });
      } catch (err) {
        console.warn('Failed to notify queue listener', err);
      }
    }
  } catch (err) {
    console.warn('Failed to get queue count for listener notification', err);
  }
}

async function runWithTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    const res = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function executeOrQueueScan(payload, monitorToken) {
  const id = generateUUID();
  const clientTimestamp = new Date().toISOString();

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
    const data = await runWithTimeout(api.scanBand(payload), TIMEOUT_MS);
    return { queued: false, data, status: 200 };
  } catch (err) {
    // Client error (4xx: validation, already linked, needs guest)
    if (err.status && err.status >= 400 && err.status < 500) {
      return {
        queued: false,
        error: err.error || 'client_error',
        message: err.message,
        status: err.status,
        data: err.data || (err.error ? { error: err.error } : null),
      };
    }

    // Network timeout or 5xx: queue for background retry
    const entry = await enqueueAction({
      id,
      type: 'scan',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry, error: err.error || 'network_error' };
  }
}

export async function executeOrQueueDeparture({ bandTokens, shortCodes }, monitorToken) {
  const id = generateUUID();
  const clientTimestamp = new Date().toISOString();
  const payload = { bandTokens, shortCodes };

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
    const data = await runWithTimeout(api.recordDepartures(payload), TIMEOUT_MS);
    return { queued: false, data, status: 200 };
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) {
      return {
        queued: false,
        error: err.error || 'client_error',
        message: err.message,
        status: err.status,
      };
    }

    const entry = await enqueueAction({
      id,
      type: 'departure',
      payload,
      clientTimestamp,
      token: monitorToken,
    });
    return { queued: true, id, clientTimestamp, entry, error: err.error || 'network_error' };
  }
}

export async function flushQueue() {
  if (isFlushing || !navigator.onLine) return;
  isFlushing = true;
  notifyQueueChanged();

  try {
    const queue = await getQueue();
    if (queue.length === 0) {
      isFlushing = false;
      notifyQueueChanged();
      return;
    }

    for (const item of queue) {
      if (!navigator.onLine) break;

      try {
        if (item.type === 'scan') {
          await api.scanBand(item.payload);
        } else {
          await api.recordDepartures(item.payload);
        }
        await removeFromQueue(item.id);
        currentBackoff = INITIAL_BACKOFF_MS;
      } catch (err) {
        if (err.status && err.status >= 400 && err.status < 500) {
          // Client error - cannot retry, remove from queue
          await removeFromQueue(item.id);
        } else {
          // Network failure: abort batch and schedule backoff
          currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF_MS);
          scheduleRetry(currentBackoff);
          break;
        }
      }
    }
  } catch (err) {
    console.warn('Queue flush encountered an error', err);
  } finally {
    isFlushing = false;
    notifyQueueChanged();
  }
}

function scheduleRetry(delayMs) {
  if (retryTimerId) clearTimeout(retryTimerId);
  retryTimerId = setTimeout(() => {
    if (navigator.onLine) {
      flushQueue();
    }
  }, delayMs);
}

export function initOfflineQueue() {
  window.addEventListener('online', () => {
    currentBackoff = INITIAL_BACKOFF_MS;
    flushQueue();
  });

  window.addEventListener('offline', () => {
    if (retryTimerId) clearTimeout(retryTimerId);
  });

  setInterval(() => {
    if (navigator.onLine && !isFlushing) {
      getQueueCount().then((count) => {
        if (count > 0) flushQueue();
      });
    }
  }, 10000);

  if (navigator.onLine) {
    setTimeout(flushQueue, 1500);
  }
}
