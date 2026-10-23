// web/shared/config.js - Backend detection and configuration

import { startDemo as runStartDemo, exitDemo as runExitDemo } from './demo-backend.js';

const STORAGE_KEY = 'hb_sheets_url';
const DEMO_STORAGE_KEY = 'hb_demo';

// Automatically detect ?demo=1 query parameter, save it to localStorage and strip it from address bar
if (typeof window !== 'undefined') {
  try {
    const params = new URLSearchParams(window.location.search);
    const demoParam = params.get('demo');
    if (demoParam === '1' || demoParam === 'true') {
      localStorage.setItem(DEMO_STORAGE_KEY, '1');
      params.delete('demo');
      const searchStr = params.toString() ? `?${params.toString()}` : '';
      window.history.replaceState({}, '', window.location.pathname + searchStr + window.location.hash);

      if (!localStorage.getItem('hb_monitor_token')) {
        localStorage.setItem('hb_admin_pin', '00000000');
        localStorage.setItem('hb_admin_monitor_code', 'DEMO42');
        localStorage.setItem('hb_admin_event_id', 'demo_event');
        localStorage.setItem('hb_monitor_token', 'mon_demo_token_you');
        localStorage.setItem('hb_monitor_event_id', 'demo_event');
        localStorage.setItem('hb_monitor_event_name', 'Sample party: Friday 10 pm');
        localStorage.setItem('hb_monitor_name', 'You');
      }

      if (!localStorage.getItem('hb_demo_sheet')) {
        runStartDemo().catch(err => console.error('Failed to auto-seed demo:', err));
      }
    }
  } catch (_) {}
}

// Where pilot sign-ups go when there's no Node server (GitHub Pages): the /exec URL of an Apps Script
// deployment of sheets/Code.gs in the founder's own "Homebound pilots" Google Sheet. Empty = not connected.
export const PILOT_SHEET_URL = '';

/**
 * Returns true if demo mode is active.
 * Checks for URL ?demo=1 (saves to localStorage and strips from address bar),
 * or localStorage.hb_demo === '1'.
 */
export function isDemo() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const demoParam = params.get('demo');
    if (demoParam === '1' || demoParam === 'true') {
      localStorage.setItem(DEMO_STORAGE_KEY, '1');
      params.delete('demo');
      const searchStr = params.toString() ? `?${params.toString()}` : '';
      window.history.replaceState({}, '', window.location.pathname + searchStr + window.location.hash);
      return true;
    }
  } catch (_) {}
  return typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_STORAGE_KEY) === '1';
}

/**
 * Start/seed demo party.
 */
export async function startDemo(options) {
  return runStartDemo(options);
}

/**
 * Exit demo mode.
 */
export function exitDemo() {
  runExitDemo();
}

/**
 * Returns current backend configuration:
 * { type: 'demo' } | { type: 'sheets', url: string | null } | { type: 'server' }
 */
export function getBackend() {
  if (typeof window === 'undefined') {
    return { type: 'server' };
  }

  // Demo mode takes priority over all other modes
  if (isDemo()) {
    return { type: 'demo' };
  }

  // Check if ?sheet=<url> query param is present, save it and clean address bar
  try {
    const params = new URLSearchParams(window.location.search);
    const sheetParam = params.get('sheet');
    if (sheetParam) {
      const cleanUrl = sheetParam.trim();
      if (cleanUrl) {
        localStorage.setItem(STORAGE_KEY, cleanUrl);
      }
      params.delete('sheet');
      const searchStr = params.toString() ? `?${params.toString()}` : '';
      window.history.replaceState({}, '', window.location.pathname + searchStr + window.location.hash);
    }
  } catch (_) {}

  // Explicitly configured Sheets URL
  const savedUrl = localStorage.getItem(STORAGE_KEY);
  if (savedUrl) {
    return { type: 'sheets', url: savedUrl };
  }

  // On GitHub Pages default to Sheets mode (url may be null until setup is completed)
  const hostname = window.location.hostname || '';
  if (hostname.endsWith('github.io')) {
    return { type: 'sheets', url: null };
  }

  // Non-Pages host (e.g. localhost, 127.0.0.1, custom VPS) defaults to Node server
  return { type: 'server' };
}

export function setSheetsUrl(url) {
  if (url) {
    localStorage.setItem(STORAGE_KEY, String(url).trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearSheetsUrl() {
  localStorage.removeItem(STORAGE_KEY);
}
