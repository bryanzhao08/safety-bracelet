// web/shared/config.js - Backend detection and configuration

const STORAGE_KEY = 'hb_sheets_url';

/**
 * Returns current backend configuration:
 * { type: 'server' } | { type: 'sheets', url: string | null }
 */
export function getBackend() {
  if (typeof window === 'undefined') {
    return { type: 'server' };
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
