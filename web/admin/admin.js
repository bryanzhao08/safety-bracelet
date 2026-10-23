// web/admin/admin.js - Single Column Sequential Organizer Admin
import * as api from '../shared/api.js';
import { generateQRSvg } from '../shared/qr.js';
import { initDemoBanner } from './demo-banner.js';

// DOM Elements
const flashBanner = document.getElementById('flash-banner');
const btnSwitchEvent = document.getElementById('btn-switch-event');

// Step 1 Elements
const step1Card = document.getElementById('step-1-card');
const eventSetupForms = document.getElementById('event-setup-forms');
const eventLoadedSummary = document.getElementById('event-loaded-summary');
const sheetsSetupNotice = document.getElementById('sheets-setup-notice');
const sheetExternalLink = document.getElementById('sheet-external-link');

const createEventForm = document.getElementById('create-event-form');
const createName = document.getElementById('create-name');
const createStarts = document.getElementById('create-starts');
const createEnds = document.getElementById('create-ends');

const loginEventForm = document.getElementById('login-event-form');
const adminEventIdInput = document.getElementById('admin-event-id');
const adminPinInput = document.getElementById('admin-pin');
const adminMonitorCodeInput = document.getElementById('admin-monitor-code');

const eventNameDisplay = document.getElementById('event-name-display');
const eventDatesDisplay = document.getElementById('event-dates-display');
const eventStatusBadge = document.getElementById('event-status-badge');
const displayMonitorCode = document.getElementById('display-monitor-code');
const adminEventCapacity = document.getElementById('admin-event-capacity');
const btnSaveCapacity = document.getElementById('btn-save-capacity');
const capacityBadgeAdmin = document.getElementById('capacity-badge-admin');

const adminStatGuests = document.getElementById('admin-stat-guests');
const adminStatBands = document.getElementById('admin-stat-bands');
const adminStatInside = document.getElementById('admin-stat-inside');

// Step 2 Elements (Guests)
const csvDropzone = document.getElementById('csv-dropzone');
const csvFileInput = document.getElementById('csv-file-input');
const csvPreview = document.getElementById('csv-preview');
const csvStatus = document.getElementById('csv-status');
const btnUploadCsv = document.getElementById('btn-upload-csv');
const csvResult = document.getElementById('csv-result');

const lumaForm = document.getElementById('luma-form');
const lumaApiKey = document.getElementById('luma-api-key');
const lumaEventId = document.getElementById('luma-event-id');

const adminGuestForm = document.getElementById('admin-guest-form');
const guestNameInput = document.getElementById('guest-name');
const guestEmailInput = document.getElementById('guest-email');
const guestPhoneInput = document.getElementById('guest-phone');

// Step 3 Elements (Bands)
const generateBandsForm = document.getElementById('generate-bands-form');
const bandCountInput = document.getElementById('band-count');
const btnViewSheet = document.getElementById('btn-view-sheet');
const btnViewAvery = document.getElementById('btn-view-avery');
const btnDownloadNfcCsv = document.getElementById('btn-download-nfc-csv');
const printSheetArea = document.getElementById('print-sheet-area');
const bandsGrid = document.getElementById('bands-grid');
const sheetPreviewTitle = document.getElementById('sheet-preview-title');
const sheetPreviewDesc = document.getElementById('sheet-preview-desc');
const btnTriggerPrint = document.getElementById('btn-trigger-print');
const btnClosePrintSheet = document.getElementById('btn-close-print-sheet');

// Step 4 Elements (Share Door Link)
const activeMonitorCodeVal = document.getElementById('active-monitor-code-val');
const activeDoorLinkVal = document.getElementById('active-door-link-val');
const activeDashLinkVal = document.getElementById('active-dash-link-val');
const btnCopyAllCredentials = document.getElementById('btn-copy-all-credentials');

// Incident Timeline Elements
const timelineSearchInput = document.getElementById('timeline-search-input');
const timelineSearchResults = document.getElementById('timeline-search-results');
const timelineCard = document.getElementById('timeline-card');
const tlGuestName = document.getElementById('tl-guest-name');
const tlGuestMeta = document.getElementById('tl-guest-meta');
const tlLastSeenVal = document.getElementById('tl-last-seen-val');
const tlCompanionsCard = document.getElementById('tl-companions-card');
const tlCompanionsList = document.getElementById('tl-companions-list');
const tlEventsContainer = document.getElementById('tl-events-container');
const btnCloseTimeline = document.getElementById('btn-close-timeline');

// Export & Danger Zone
const btnDownloadExportCsv = document.getElementById('btn-download-export-csv');
const btnEndEvent = document.getElementById('btn-end-event');

// Secrets Modal Elements
const secretsModal = document.getElementById('secrets-modal');
const secretPin = document.getElementById('secret-pin');
const secretMonitorCode = document.getElementById('secret-monitor-code');
const secretEventId = document.getElementById('secret-event-id');
const btnCopyAll = document.getElementById('btn-copy-all');
const copyAllFeedback = document.getElementById('copy-all-feedback');
const btnDismissSecrets = document.getElementById('btn-dismiss-secrets');

// State
let currentEvent = null;
let selectedCsvFile = null;
let currentBands = [];
let printFormat = 'standard';
let timelineSearchTimeout = null;

// --- Flash Messages ---
function showFlash(message, type = 'green', duration = 3000) {
  if (!flashBanner) return;
  flashBanner.textContent = message;
  flashBanner.className = `flash-banner flash-${type} show`;
  setTimeout(() => {
    flashBanner.className = 'flash-banner';
  }, duration);
}

// --- Sheets Mode Integration ---
function checkSheetsMode() {
  let googleSheetUrl = null;
  if (typeof api.getSheetUrl === 'function') {
    googleSheetUrl = api.getSheetUrl();
  } else {
    googleSheetUrl = localStorage.getItem('hb_sheets_url');
  }

  if (sheetExternalLink) {
    if (googleSheetUrl) {
      sheetExternalLink.href = googleSheetUrl;
      sheetExternalLink.classList.remove('hidden');
    } else {
      sheetExternalLink.classList.add('hidden');
    }
  }
}

// --- Initialize Form Defaults ---
function initDatePickers() {
  const now = new Date();
  const starts = new Date(now.getTime() + 60 * 60 * 1000);
  const ends = new Date(now.getTime() + 6 * 60 * 60 * 1000);

  const formatLocal = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  if (createStarts) createStarts.value = formatLocal(starts);
  if (createEnds) createEnds.value = formatLocal(ends);
}

// --- Event Creation ---
createEventForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  sheetsSetupNotice?.classList.add('hidden');

  const name = createName.value.trim();
  const startsAt = createStarts.value;
  const endsAt = createEnds.value;

  try {
    const res = await api.createEvent({ name, startsAt, endsAt });

    secretPin.textContent = res.adminPin;
    secretMonitorCode.textContent = res.monitorCode;
    secretEventId.textContent = res.eventId;
    secretsModal.classList.add('open');

    try {
      await api.joinMonitor(res.eventId, { monitorCode: res.monitorCode, name: 'Organizer Admin' });
    } catch {}
  } catch (err) {
    if (err.error === 'use_sheet_setup' || err.message?.includes('use_sheet_setup')) {
      sheetsSetupNotice?.classList.remove('hidden');
      return;
    }
    showFlash(err.message || 'Failed to create event', 'red');
  }
});

btnDismissSecrets?.addEventListener('click', async () => {
  secretsModal.classList.remove('open');
  const session = api.getAdminSession();
  if (session) {
    await loadEvent(session.eventId);
  }
});

// Copy all button
function copyCredentialsToClipboard() {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const eventId = session.eventId;
  const pin = session.pin || secretPin.textContent || '—';
  const monitorCode = session.monitorCode || secretMonitorCode.textContent || '—';
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/admin\/?.*$/, '');
  const doorUrl = `${baseUrl}/door/?event=${encodeURIComponent(eventId)}&code=${encodeURIComponent(monitorCode)}`;
  const dashUrl = `${baseUrl}/dashboard/?event=${encodeURIComponent(eventId)}&code=${encodeURIComponent(monitorCode)}`;
  const name = currentEvent?.name || 'Homebound Event';

  const fullText = `Homebound Safety Event
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event: ${name}
Door Monitor Code: ${monitorCode}

Door Scanner:
${doorUrl}

Live Dashboard:
${dashUrl}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Admin PIN: ${pin}`;

  navigator.clipboard.writeText(fullText).then(() => {
    showFlash('Copied event details to clipboard', 'green');
    if (copyAllFeedback) copyAllFeedback.classList.remove('hidden');
    setTimeout(() => {
      if (copyAllFeedback) copyAllFeedback.classList.add('hidden');
    }, 2500);
  });
}

btnCopyAll?.addEventListener('click', copyCredentialsToClipboard);
btnCopyAllCredentials?.addEventListener('click', copyCredentialsToClipboard);

document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const text = document.getElementById(targetId)?.textContent;
    if (text && text !== '—') {
      navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = prev; }, 1500);
    }
  });
});

// --- Login to Existing Event ---
loginEventForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventId = adminEventIdInput.value.trim();
  const pin = adminPinInput.value.trim();
  const code = adminMonitorCodeInput?.value.trim().toUpperCase() || null;

  try {
    const data = await api.getEvent(eventId, pin);
    api.saveAdminSession({ eventId, adminPin: pin, monitorCode: code });
    currentEvent = data.event;
    renderEventStats(data);
    showAdminView();

    if (code) {
      try {
        await api.joinMonitor(eventId, { monitorCode: code, name: 'Organizer Admin' });
      } catch {}
    }
  } catch (err) {
    showFlash('Invalid Event ID or Admin PIN', 'red');
  }
});

async function loadEvent(eventId) {
  try {
    const data = await api.getEvent(eventId);
    currentEvent = data.event;
    renderEventStats(data);
    showAdminView();
  } catch (err) {
    showFlash('Failed to load event data', 'red');
    throw err;
  }
}

function renderEventStats(data) {
  const e = data.event;
  const s = data.stats || {};

  eventNameDisplay.textContent = e.name;
  eventDatesDisplay.textContent = `${api.formatDateTime(e.startsAt)} — ${api.formatDateTime(e.endsAt)}`;

  const isEnded = new Date(e.endsAt) < new Date();
  eventStatusBadge.className = isEnded ? 'badge badge-muted' : 'badge badge-green';
  eventStatusBadge.textContent = isEnded ? 'Ended' : 'Active';

  const monitorCode = api.getAdminSession()?.monitorCode || e.monitorCode;
  if (monitorCode) {
    displayMonitorCode.textContent = `Door Code: ${monitorCode}`;
    if (activeMonitorCodeVal) activeMonitorCodeVal.textContent = monitorCode;

    const baseUrl = window.location.origin + window.location.pathname.replace(/\/admin\/?.*$/, '');
    if (activeDoorLinkVal) activeDoorLinkVal.textContent = `${baseUrl}/door/?event=${e.id}&code=${monitorCode}`;
    if (activeDashLinkVal) activeDashLinkVal.textContent = `${baseUrl}/dashboard/?event=${e.id}&code=${monitorCode}`;
  }

  adminStatGuests.textContent = s.guests ?? 0;
  adminStatBands.textContent = s.bands ?? 0;
  adminStatInside.textContent = s.inside ?? 0;

  const cap = e.capacity || api.getEventCapacity(e.id);
  if (adminEventCapacity) adminEventCapacity.value = cap || '';
  if (capacityBadgeAdmin) {
    capacityBadgeAdmin.className = cap ? 'badge badge-green' : 'badge badge-muted';
    capacityBadgeAdmin.textContent = cap ? `${cap} capacity limit` : 'No limit';
  }

  checkSheetsMode();
}

function showAdminView() {
  eventSetupForms?.classList.add('hidden');
  eventLoadedSummary?.classList.remove('hidden');
  btnSwitchEvent?.classList.remove('hidden');
  const badge = document.getElementById('step-1-badge');
  if (badge) {
    badge.textContent = 'Connected';
    badge.className = 'badge badge-green';
  }
}

btnSwitchEvent?.addEventListener('click', () => {
  if (confirm('Switch event? You will need your Event ID and PIN to reconnect.')) {
    api.clearAdminSession();
    window.location.reload();
  }
});

btnSaveCapacity?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const val = adminEventCapacity.value.trim();
  const num = val ? parseInt(val, 10) : null;

  api.saveEventCapacity(session.eventId, val);

  try {
    if (num && num > 0) {
      await api.updateEvent(session.eventId, { capacity: num });
    }
  } catch {}

  const cap = api.getEventCapacity(session.eventId);
  if (capacityBadgeAdmin) {
    capacityBadgeAdmin.className = cap ? 'badge badge-green' : 'badge badge-muted';
    capacityBadgeAdmin.textContent = cap ? `${cap} capacity limit` : 'No limit';
  }
  showFlash(cap ? `Capacity saved: ${cap} guests` : 'Capacity limit removed', 'green');
});

// --- Step 2: Guest Import (CSV) ---
csvDropzone?.addEventListener('click', () => csvFileInput.click());
csvDropzone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  csvDropzone.classList.add('dragover');
});
csvDropzone?.addEventListener('dragleave', () => csvDropzone.classList.remove('dragover'));
csvDropzone?.addEventListener('drop', (e) => {
  e.preventDefault();
  csvDropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleCsvFile(e.dataTransfer.files[0]);
});
csvFileInput?.addEventListener('change', () => {
  if (csvFileInput.files.length) handleCsvFile(csvFileInput.files[0]);
});

function handleCsvFile(file) {
  if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
    showFlash('Please select a valid .csv file', 'red');
    return;
  }
  selectedCsvFile = file;
  csvStatus.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
  csvPreview.classList.remove('hidden');
}

btnUploadCsv?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId || !selectedCsvFile) return;

  try {
    const text = await selectedCsvFile.text();
    const res = await api.importCsv(session.eventId, text);

    const imported = Number(res?.imported) || 0;
    const skipped = Number(res?.skipped) || 0;
    let breakdown = '';
    if (res?.skippedReasons && typeof res.skippedReasons === 'object') {
      const parts = Object.entries(res.skippedReasons)
        .filter(([, count]) => typeof count === 'number' && count > 0)
        .map(([reason, count]) => `${reason.replace(/_/g, ' ')} ${count}`);
      if (parts.length > 0) breakdown = ` (${parts.join(', ')})`;
    }

    csvResult.className = 'badge badge-green mt-sm';
    csvResult.textContent = `Imported ${imported} · skipped ${skipped}${breakdown}`;
    csvResult.classList.remove('hidden');

    showFlash(`Imported ${imported} guests`, 'green');
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'Failed to import CSV', 'red');
  }
});

lumaForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  try {
    const res = await api.importLuma(session.eventId, {
      apiKey: lumaApiKey.value.trim(),
      lumaEventId: lumaEventId.value.trim(),
    });
    showFlash(`Luma sync complete: ${res.imported} imported, ${res.updated} updated`, 'green');
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'Luma sync failed', 'red');
  }
});

adminGuestForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  try {
    const res = await api.addWalkInGuest(session.eventId, {
      name: guestNameInput.value.trim(),
      email: guestEmailInput.value.trim(),
      phone: guestPhoneInput.value.trim(),
    });
    showFlash(`Added ${res.guest.name} to roster`, 'green');
    guestNameInput.value = '';
    guestEmailInput.value = '';
    guestPhoneInput.value = '';
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'Failed to add guest', 'red');
  }
});

// --- Step 3: Make Bands & Printable Sheets ---
generateBandsForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const count = parseInt(bandCountInput.value, 10);
  try {
    const res = await api.generateBands(session.eventId, count);
    currentBands = res.bands || [];
    showFlash(`Generated ${currentBands.length} wristbands`, 'green');
    await loadEvent(session.eventId);
    renderPrintableSheets(currentBands);
  } catch (err) {
    showFlash(err.message || 'Failed to generate bands', 'red');
  }
});

btnViewSheet?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;
  printFormat = 'standard';
  sheetPreviewTitle.textContent = 'Print Preview (Standard Wristband Cards)';
  await ensureBandsLoaded();
  renderPrintableSheets(currentBands);
});

btnViewAvery?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;
  printFormat = 'avery';
  sheetPreviewTitle.textContent = 'Print Preview: Avery-Style 2"×1" Labels';
  await ensureBandsLoaded();
  renderPrintableSheets(currentBands);
});

btnDownloadNfcCsv?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;
  try {
    const csvData = await api.getBandsCsv(session.eventId);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bands-${session.eventId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showFlash(err.message || 'Failed to download NFC CSV', 'red');
  }
});

async function ensureBandsLoaded() {
  if (currentBands.length > 0) return;
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  try {
    const csv = await api.getBandsCsv(session.eventId);
    const lines = csv.trim().split('\n');
    currentBands = lines.map(line => {
      const parts = line.split(',');
      return { shortCode: parts[0]?.trim(), url: parts[1]?.trim() };
    }).filter(b => b.shortCode && b.url);
  } catch {}
}

function renderPrintableSheets(bands) {
  bandsGrid.innerHTML = '';
  if (!bands || bands.length === 0) {
    showFlash('Generate bands first to view sheets', 'amber');
    return;
  }

  bands.forEach(band => {
    const card = document.createElement('div');
    card.className = 'band-card-preview';
    const qrSvg = generateQRSvg(band.url, 110);

    card.innerHTML = `
      <div style="width: 110px; height: 110px;">${qrSvg}</div>
      <div style="font-family: var(--font-display); font-size: var(--text-20); font-weight: 800; letter-spacing: 0.15em;">
        ${escapeHtml(band.shortCode)}
      </div>
      <div style="font-size: 11px; color: #555;">Homebound Safety Band</div>
    `;
    bandsGrid.appendChild(card);
  });

  printSheetArea.classList.add('open');
}

btnTriggerPrint?.addEventListener('click', () => window.print());
btnClosePrintSheet?.addEventListener('click', () => printSheetArea.classList.remove('open'));

// --- Incident Timeline Follow-up ---
timelineSearchInput?.addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(timelineSearchTimeout);
  if (!q) {
    timelineSearchResults.classList.add('hidden');
    return;
  }

  timelineSearchTimeout = setTimeout(async () => {
    try {
      const guests = await api.searchGuests(q);
      renderTimelineSearchResults(guests);
    } catch {}
  }, 250);
});

function renderTimelineSearchResults(guests) {
  timelineSearchResults.innerHTML = '';
  if (!guests || guests.length === 0) {
    timelineSearchResults.innerHTML = '<div style="padding: 0.5rem; font-size: var(--text-14); color: var(--slate);">No matching guests found</div>';
    timelineSearchResults.classList.remove('hidden');
    return;
  }

  guests.forEach(g => {
    const div = document.createElement('div');
    div.style.padding = '0.5rem 0.75rem';
    div.style.cursor = 'pointer';
    div.style.borderRadius = '4px';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.innerHTML = `
      <span style="font-weight: 700;">${escapeHtml(g.name)}</span>
      <span style="font-size: var(--text-14); color: var(--slate);">${g.band ? `[${g.band}]` : ''}</span>
    `;
    div.addEventListener('click', () => {
      timelineSearchResults.classList.add('hidden');
      loadGuestTimeline(g.id);
    });
    timelineSearchResults.appendChild(div);
  });
  timelineSearchResults.classList.remove('hidden');
}

async function loadGuestTimeline(guestId) {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  try {
    const data = await api.getGuestTimeline(session.eventId, guestId);
    renderTimelineCard(data);
  } catch (err) {
    showFlash(err.message || 'Failed to load guest timeline', 'red');
  }
}

function renderTimelineCard(data) {
  const g = data.guest || {};
  tlGuestName.textContent = g.name || 'Guest';
  tlGuestMeta.textContent = `Email: ${g.email || '—'} · Phone: ${g.phone || '—'}`;

  tlLastSeenVal.textContent = data.lastSeenInsideAt ? api.formatDateTime(data.lastSeenInsideAt) : 'Not recorded inside';

  if (data.leftWith && data.leftWith.length > 0) {
    tlCompanionsCard.classList.remove('hidden');
    tlCompanionsList.textContent = data.leftWith.map(c => `${c.name}${c.phone ? ' (' + c.phone + ')' : ''}`).join(', ');
  } else {
    tlCompanionsCard.classList.add('hidden');
  }

  tlEventsContainer.innerHTML = '';
  const events = (data.events || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  if (events.length === 0) {
    tlEventsContainer.innerHTML = '<div class="text-muted">No timeline entries logged for this guest</div>';
  } else {
    events.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'timeline-event-row';

      if (ev.type === 'met') {
        const targetName = ev.detail?.with || ev.detail?.name || (typeof ev.detail === 'string' ? ev.detail : 'friend');
        item.innerHTML = `
          <span class="timeline-time">${api.formatDateTime(ev.at)}</span> &middot;
          <span class="timeline-met-entry">
            <span class="timeline-pink-dot" aria-hidden="true"></span>
            <strong>Met ${escapeHtml(targetName)}</strong>
          </span>
        `;
      } else if (ev.type === 'in') {
        item.innerHTML = `
          <span class="timeline-time">${api.formatDateTime(ev.at)}</span> &middot;
          <strong style="color: var(--band-orange);">Door check-in</strong>
        `;
      } else if (ev.type === 'out') {
        item.innerHTML = `
          <span class="timeline-time">${api.formatDateTime(ev.at)}</span> &middot;
          <strong style="color: var(--slate);">Door exit</strong>
        `;
      } else if (ev.type === 'departure') {
        const withWho = ev.detail?.with || ev.detail?.people;
        const withStr = Array.isArray(withWho) && withWho.length > 0 ? ` with ${escapeHtml(withWho.join(', '))}` : '';
        item.innerHTML = `
          <span class="timeline-time">${api.formatDateTime(ev.at)}</span> &middot;
          <strong style="color: var(--band-pink);">Left${withStr}</strong>
        `;
      } else if (ev.type === 'id_check') {
        item.innerHTML = `
          <span class="timeline-time">${api.formatDateTime(ev.at)}</span> &middot;
          <strong style="color: var(--tyvek);">ID verified</strong>
        `;
      } else {
        item.innerHTML = `
          <span class="timeline-time">${api.formatDateTime(ev.at)}</span> &middot;
          <strong style="color: var(--tyvek);">${escapeHtml(ev.type.toUpperCase())}</strong>
          ${ev.detail ? `<span style="color: var(--slate);"> &mdash; ${escapeHtml(JSON.stringify(ev.detail))}</span>` : ''}
        `;
      }
      tlEventsContainer.appendChild(item);
    });
  }

  timelineCard.classList.remove('hidden');
}

btnCloseTimeline?.addEventListener('click', () => timelineCard.classList.add('hidden'));

// --- Export & End Event ---
btnDownloadExportCsv?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  try {
    const csvData = await api.getExportCsv(session.eventId);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `homebound-export-${session.eventId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showFlash(err.message || 'Failed to download export', 'red');
  }
});

btnEndEvent?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  if (confirm('End this event now? This stops new check-ins and schedules data deletion in 30 days.')) {
    try {
      await api.endEvent(session.eventId);
      showFlash('Event ended', 'green');
      await loadEvent(session.eventId);
    } catch (err) {
      showFlash(err.message || 'Failed to end event', 'red');
    }
  }
});

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// --- Initialize Session ---
async function init() {
  initDemoBanner();
  initDatePickers();
  checkSheetsMode();

  const urlParams = new URLSearchParams(window.location.search);
  const urlEvent = urlParams.get('event') || urlParams.get('eventId');
  const urlPin = urlParams.get('pin') || urlParams.get('adminPin');
  const urlCode = urlParams.get('code') || urlParams.get('monitorCode');

  if (urlEvent && urlPin) {
    try {
      const data = await api.getEvent(urlEvent, urlPin);
      api.saveAdminSession({ eventId: urlEvent, adminPin: urlPin, monitorCode: urlCode });
      currentEvent = data.event;
      renderEventStats(data);
      showAdminView();
      if (urlCode) {
        try {
          await api.joinMonitor(urlEvent, { monitorCode: urlCode, name: 'Organizer Admin' });
        } catch {}
      }
      return;
    } catch (e) {
      console.warn('Auto-login from URL failed:', e);
    }
  }

  const session = api.getAdminSession();
  if (session && session.eventId && session.pin) {
    try {
      await loadEvent(session.eventId);
    } catch {
      api.clearAdminSession();
    }
  }
}

init();
