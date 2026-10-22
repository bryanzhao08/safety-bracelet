// web/admin/admin.js - Organizer Administration Controller
import * as api from '/shared/api.js';
import { generateQRSvg } from '/shared/qr.js';

// DOM Elements
const flashBanner = document.getElementById('flash-banner');
const authView = document.getElementById('auth-view');
const eventAdminView = document.getElementById('event-admin-view');
const btnSwitchEvent = document.getElementById('btn-switch-event');

// Event Details & Stats Elements
const eventNameDisplay = document.getElementById('event-name-display');
const eventDatesDisplay = document.getElementById('event-dates-display');
const eventStatusBadge = document.getElementById('event-status-badge');
const displayMonitorCode = document.getElementById('display-monitor-code');

const adminStatGuests = document.getElementById('admin-stat-guests');
const adminStatBands = document.getElementById('admin-stat-bands');
const adminStatInside = document.getElementById('admin-stat-inside');
const adminStatChecked = document.getElementById('admin-stat-checked');
const adminStatLeft = document.getElementById('admin-stat-left');
const adminStatGroups = document.getElementById('admin-stat-groups');

// Capacity in Admin
const adminEventCapacity = document.getElementById('admin-event-capacity');
const btnSaveCapacity = document.getElementById('btn-save-capacity');
const capacityBadgeAdmin = document.getElementById('capacity-badge-admin');

// Creation & Login Forms
const createEventForm = document.getElementById('create-event-form');
const createName = document.getElementById('create-name');
const createStarts = document.getElementById('create-starts');
const createEnds = document.getElementById('create-ends');

const loginEventForm = document.getElementById('login-event-form');
const adminEventIdInput = document.getElementById('admin-event-id');
const adminPinInput = document.getElementById('admin-pin');
const adminMonitorCodeInput = document.getElementById('admin-monitor-code');

// Tabs
const adminTabs = document.querySelectorAll('.admin-tab');
const adminSections = document.querySelectorAll('.admin-section');

// Guest Management Forms
const lumaForm = document.getElementById('luma-form');
const lumaApiKey = document.getElementById('luma-api-key');
const lumaEventId = document.getElementById('luma-event-id');

const csvDropzone = document.getElementById('csv-dropzone');
const csvFileInput = document.getElementById('csv-file-input');
const csvPreview = document.getElementById('csv-preview');
const csvStatus = document.getElementById('csv-status');
const btnUploadCsv = document.getElementById('btn-upload-csv');

const adminGuestForm = document.getElementById('admin-guest-form');
const guestName = document.getElementById('guest-name');
const guestEmail = document.getElementById('guest-email');
const guestPhone = document.getElementById('guest-phone');

// Band Management Forms
const generateBandsForm = document.getElementById('generate-bands-form');
const bandCountInput = document.getElementById('band-count');
const btnViewSheet = document.getElementById('btn-view-sheet');
const btnViewAvery = document.getElementById('btn-view-avery');
const btnDownloadNfcCsv = document.getElementById('btn-download-nfc-csv');
const printSheetArea = document.getElementById('print-sheet-area');
const bandsGrid = document.getElementById('bands-grid');
const btnTriggerPrint = document.getElementById('btn-trigger-print');
const btnClosePrintSheet = document.getElementById('btn-close-print-sheet');
const sheetPreviewTitle = document.getElementById('sheet-preview-title');
const sheetPreviewDesc = document.getElementById('sheet-preview-desc');
const btnFormatStandard = document.getElementById('btn-format-standard');
const btnFormatAvery = document.getElementById('btn-format-avery');

// Incident Timeline Elements
const timelineSearchInput = document.getElementById('timeline-search-input');
const timelineSearchResults = document.getElementById('timeline-search-results');
const timelineCard = document.getElementById('timeline-card');
const tlGuestName = document.getElementById('tl-guest-name');
const tlGuestMeta = document.getElementById('tl-guest-meta');
const tlBandChip = document.getElementById('tl-band-chip');
const tlAgeBadge = document.getElementById('tl-age-badge');
const tlStateBadge = document.getElementById('tl-state-badge');
const tlLastSeenVal = document.getElementById('tl-last-seen-val');
const tlCompanionsCard = document.getElementById('tl-companions-card');
const tlCompanionsList = document.getElementById('tl-companions-list');
const tlEventsContainer = document.getElementById('tl-events-container');
const btnPrintTimeline = document.getElementById('btn-print-timeline');
const btnCloseTimeline = document.getElementById('btn-close-timeline');
const tlPrintMeta = document.getElementById('tl-print-meta');
const timelineAuthHelper = document.getElementById('timeline-auth-helper');
const timelineMonitorCodeInput = document.getElementById('timeline-monitor-code-input');
const btnConnectTimelineMonitor = document.getElementById('btn-connect-timeline-monitor');

// Export & Danger Zone
const btnDownloadExportCsv = document.getElementById('btn-download-export-csv');
const btnEndEvent = document.getElementById('btn-end-event');

// Secrets Modal
const secretsModal = document.getElementById('secrets-modal');
const secretPin = document.getElementById('secret-pin');
const secretMonitorCode = document.getElementById('secret-monitor-code');
const secretEventId = document.getElementById('secret-event-id');
const doorLink = document.getElementById('door-link');
const dashboardLink = document.getElementById('dashboard-link');
const btnDismissSecrets = document.getElementById('btn-dismiss-secrets');
const btnCopyAll = document.getElementById('btn-copy-all');
const copyAllFeedback = document.getElementById('copy-all-feedback');

// State
let currentEvent = null;
let selectedCsvText = null;
let currentBands = [];
let currentSheetFormat = 'standard'; // 'standard' or 'avery'
let searchDebounceTimer = null;

function showFlash(message, type = 'green', duration = 3000) {
  flashBanner.textContent = message;
  flashBanner.className = `flash-banner flash-${type} show`;
  setTimeout(() => {
    flashBanner.className = `flash-banner flash-${type}`;
  }, duration);
}

// --- Init & Auth ---

async function init() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  createStarts.value = now.toISOString().slice(0, 16);
  createEnds.value = tomorrow.toISOString().slice(0, 16);

  const session = api.getAdminSession();
  if (session && session.eventId && session.pin) {
    try {
      await loadEvent(session.eventId);
    } catch {
      api.clearAdminSession();
      showAuthView();
    }
  } else {
    showAuthView();
  }
}

function showAuthView() {
  authView.classList.remove('hidden');
  eventAdminView.classList.add('hidden');
  btnSwitchEvent.classList.add('hidden');
}

function showAdminView() {
  authView.classList.add('hidden');
  eventAdminView.classList.remove('hidden');
  btnSwitchEvent.classList.remove('hidden');
}

btnSwitchEvent.addEventListener('click', () => {
  if (confirm('Switch or manage another event?')) {
    api.clearAdminSession();
    showAuthView();
  }
});

// --- Create Event ---

createEventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = createName.value.trim();
  const startsAt = new Date(createStarts.value).toISOString();
  const endsAt = new Date(createEnds.value).toISOString();

  try {
    const res = await api.createEvent({ name, startsAt, endsAt });

    // Show secrets once modal
    secretPin.textContent = res.adminPin;
    secretMonitorCode.textContent = res.monitorCode;
    secretEventId.textContent = res.eventId;

    const host = window.location.origin;
    const doorUrl = `${host}/door?event=${res.eventId}&code=${res.monitorCode}`;
    const dashUrl = `${host}/dashboard?event=${res.eventId}`;

    doorLink.href = doorUrl;
    doorLink.textContent = doorUrl;
    dashboardLink.href = dashUrl;
    dashboardLink.textContent = dashUrl;

    copyAllFeedback.classList.add('hidden');
    secretsModal.classList.add('open');

    // Save session with monitor code
    api.saveAdminSession({
      eventId: res.eventId,
      adminPin: res.adminPin,
      monitorCode: res.monitorCode,
    });

    // Auto-join monitor session for seamless roster search
    try {
      await api.joinMonitor(res.eventId, { monitorCode: res.monitorCode, name: 'Organizer Admin' });
    } catch {}
  } catch (err) {
    showFlash(err.message || 'Failed to create event', 'red');
  }
});

btnDismissSecrets.addEventListener('click', async () => {
  secretsModal.classList.remove('open');
  const session = api.getAdminSession();
  if (session) {
    await loadEvent(session.eventId);
  }
});

// Single "Copy All Details" button
btnCopyAll?.addEventListener('click', () => {
  const eventId = secretEventId.textContent;
  const pin = secretPin.textContent;
  const monitorCode = secretMonitorCode.textContent;
  const doorUrl = doorLink.href;
  const dashUrl = dashboardLink.href;
  const name = currentEvent?.name || createName?.value.trim() || 'Homebound Event';

  const fullText = `Homebound Event Credentials
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event Name: ${name}
Event ID: ${eventId}
Admin PIN: ${pin} (Save this! Never shown again)
Door Monitor Code: ${monitorCode}

Door Scanner Link:
${doorUrl}

Live Dashboard Link:
${dashUrl}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  navigator.clipboard.writeText(fullText).then(() => {
    copyAllFeedback.classList.remove('hidden');
    const originalText = btnCopyAll.textContent;
    btnCopyAll.textContent = '✓ All Details Copied!';
    setTimeout(() => {
      btnCopyAll.textContent = originalText;
    }, 2000);
  });
});

// Individual Clipboard copy helpers
document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const text = document.getElementById(targetId)?.textContent;
    if (text) {
      navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = prev; }, 1500);
    }
  });
});

// --- Login to Existing Event ---

loginEventForm.addEventListener('submit', async (e) => {
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

// --- Load Event Details & Stats ---

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
  if (isEnded) {
    eventStatusBadge.className = 'badge badge-muted';
    eventStatusBadge.textContent = 'Ended';
  } else {
    eventStatusBadge.className = 'badge badge-green';
    eventStatusBadge.textContent = 'Active';
  }

  const monitorCode = api.getAdminSession()?.monitorCode;
  if (monitorCode) {
    displayMonitorCode.textContent = `Door Code: ${monitorCode}`;
  }

  adminStatGuests.textContent = s.guests ?? 0;
  adminStatBands.textContent = s.bands ?? 0;
  adminStatInside.textContent = s.inside ?? 0;
  adminStatChecked.textContent = s.checkedIn ?? 0;
  adminStatLeft.textContent = s.left ?? 0;
  adminStatGroups.textContent = s.groups ?? 0;

  // Capacity limit
  const cap = e.capacity || api.getEventCapacity(e.id);
  if (adminEventCapacity) adminEventCapacity.value = cap || '';
  if (capacityBadgeAdmin) {
    capacityBadgeAdmin.className = cap ? 'badge badge-green' : 'badge badge-muted';
    capacityBadgeAdmin.textContent = cap ? `${cap} capacity limit` : 'No limit';
  }

  // Update download link for NFC CSV
  btnDownloadNfcCsv.href = `/api/events/${encodeURIComponent(e.id)}/bands.csv`;
}

// Capacity limit save
btnSaveCapacity?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const val = adminEventCapacity.value.trim();
  const num = val ? parseInt(val, 10) : null;

  api.saveEventCapacity(session.eventId, val);

  try {
    if (num && num > 0) {
      const res = await api.updateEvent(session.eventId, { capacity: num });
      if (res?.event?.capacity) {
        currentEvent.capacity = res.event.capacity;
      }
    }
  } catch (err) {
    console.warn('Server capacity PATCH fallback to localStorage:', err);
  }

  const cap = currentEvent?.capacity || api.getEventCapacity(session.eventId);
  if (capacityBadgeAdmin) {
    capacityBadgeAdmin.className = cap ? 'badge badge-green' : 'badge badge-muted';
    capacityBadgeAdmin.textContent = cap ? `${cap} capacity limit` : 'No limit';
  }
  showFlash(cap ? `Capacity saved: ${cap} guests` : 'Capacity limit removed', 'green');
});

// --- Tabs Navigation ---

adminTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    adminTabs.forEach(t => t.classList.remove('active'));
    adminSections.forEach(s => s.classList.remove('active'));

    tab.classList.add('active');
    const targetSection = document.getElementById(`tab-${tab.dataset.tab}`);
    if (targetSection) targetSection.classList.add('active');

    if (tab.dataset.tab === 'timeline') {
      checkTimelineAuth();
    }
  });
});

// --- Luma API Import ---

lumaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const apiKey = lumaApiKey.value.trim();
  const lumaId = lumaEventId.value.trim();

  try {
    const res = await api.importLuma(session.eventId, { apiKey, lumaEventId: lumaId });
    showFlash(`Luma sync complete: ${res.imported} imported, ${res.updated} updated`, 'green');
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'Luma import failed', 'red');
  }
});

// --- Partiful / Luma CSV Upload ---

csvDropzone.addEventListener('click', () => csvFileInput.click());

csvDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  csvDropzone.classList.add('dragover');
});

csvDropzone.addEventListener('dragleave', () => {
  csvDropzone.classList.remove('dragover');
});

csvDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  csvDropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    handleCsvFile(e.dataTransfer.files[0]);
  }
});

csvFileInput.addEventListener('change', () => {
  if (csvFileInput.files.length) {
    handleCsvFile(csvFileInput.files[0]);
  }
});

function handleCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    selectedCsvText = e.target.result;
    const lines = selectedCsvText.split(/\r?\n/).filter(Boolean);
    csvStatus.textContent = `Selected: ${file.name} (~${Math.max(0, lines.length - 1)} guest rows)`;
    csvPreview.classList.remove('hidden');
  };
  reader.readAsText(file);
}

btnUploadCsv.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId || !selectedCsvText) return;

  try {
    const res = await api.importCsv(session.eventId, selectedCsvText);
    showFlash(`CSV imported: ${res.imported} guests added, ${res.skipped} skipped`, 'green');
    csvPreview.classList.add('hidden');
    selectedCsvText = null;
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'CSV upload failed', 'red');
  }
});

// --- Add Walk-in Guest (Admin) ---

adminGuestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const name = guestName.value.trim();
  const email = guestEmail.value.trim();
  const phone = guestPhone.value.trim();

  try {
    await api.addWalkInGuest(session.eventId, { name, email, phone });
    showFlash(`Guest added: ${name}`, 'green');
    guestName.value = '';
    guestEmail.value = '';
    guestPhone.value = '';
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'Failed to add guest', 'red');
  }
});

// --- Generate Wristbands ---

generateBandsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const count = parseInt(bandCountInput.value, 10);
  if (!count || count < 1 || count > 2000) {
    showFlash('Please specify between 1 and 2,000 bands', 'amber');
    return;
  }

  try {
    const res = await api.generateBands(session.eventId, count);
    currentBands = res.bands || [];
    showFlash(`Generated ${currentBands.length} wristbands`, 'green');
    renderSheet();
    printSheetArea.style.display = 'block';
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'Failed to generate bands', 'red');
  }
});

// --- Printable Band Sheets (Standard & Avery-style 2"x1" Labels) ---

async function ensureBandsLoaded() {
  const session = api.getAdminSession();
  if (!session?.eventId) return false;

  if (currentBands.length === 0) {
    try {
      const csvStr = await api.getBandsCsv(session.eventId);
      const lines = csvStr.split(/\r?\n/).filter(Boolean).slice(1);
      currentBands = lines.map(line => {
        const [shortCode, url] = line.split(',');
        return { shortCode, url };
      });
    } catch {
      showFlash('Generate bands first to view printable sheets', 'amber');
      return false;
    }
  }

  if (currentBands.length === 0) {
    showFlash('No bands generated for this event yet', 'amber');
    return false;
  }
  return true;
}

btnViewSheet?.addEventListener('click', async () => {
  if (await ensureBandsLoaded()) {
    setSheetFormat('standard');
    printSheetArea.style.display = 'block';
    printSheetArea.scrollIntoView({ behavior: 'smooth' });
  }
});

btnViewAvery?.addEventListener('click', async () => {
  if (await ensureBandsLoaded()) {
    setSheetFormat('avery');
    printSheetArea.style.display = 'block';
    printSheetArea.scrollIntoView({ behavior: 'smooth' });
  }
});

btnFormatStandard?.addEventListener('click', () => setSheetFormat('standard'));
btnFormatAvery?.addEventListener('click', () => setSheetFormat('avery'));

function setSheetFormat(format) {
  currentSheetFormat = format;
  if (format === 'avery') {
    btnFormatAvery?.classList.add('active');
    btnFormatStandard?.classList.remove('active');
    if (sheetPreviewTitle) sheetPreviewTitle.textContent = 'Print Preview: Avery-Style 2"×1" Labels';
    if (sheetPreviewDesc) sheetPreviewDesc.textContent = 'Formatted for Avery 5160 / 5260 or 2"×1" wristband tag labels';
  } else {
    btnFormatStandard?.classList.add('active');
    btnFormatAvery?.classList.remove('active');
    if (sheetPreviewTitle) sheetPreviewTitle.textContent = 'Print Preview: Standard Wristband Cards';
    if (sheetPreviewDesc) sheetPreviewDesc.textContent = 'Large format wristband cards (3 columns)';
  }
  renderSheet();
}

function renderSheet() {
  if (currentSheetFormat === 'avery') {
    renderAveryLabels(currentBands);
  } else {
    renderStandardBands(currentBands);
  }
}

function renderStandardBands(bands) {
  bandsGrid.className = 'band-grid';
  bandsGrid.innerHTML = '';
  const eventName = currentEvent?.name || 'Homebound';

  bands.forEach(band => {
    const card = document.createElement('div');
    card.className = 'band-card';
    const qrSvg = generateQRSvg(band.url, { size: 130 });

    card.innerHTML = `
      <div class="band-card-event">${eventName}</div>
      <div class="band-card-qr">${qrSvg}</div>
      <div class="band-card-code">${band.shortCode}</div>
      <div class="band-card-sub">Tap tag or scan at door</div>
    `;
    bandsGrid.appendChild(card);
  });
}

function renderAveryLabels(bands) {
  bandsGrid.className = 'avery-grid';
  bandsGrid.innerHTML = '';
  const eventName = currentEvent?.name || 'Homebound';

  bands.forEach(band => {
    const card = document.createElement('div');
    card.className = 'avery-card';
    const qrSvg = generateQRSvg(band.url, { size: 85 });

    card.innerHTML = `
      <div class="avery-qr">${qrSvg}</div>
      <div class="avery-info">
        <div class="avery-event">${eventName}</div>
        <div class="avery-code">${band.shortCode}</div>
        <div class="avery-tag">NFC / QR Tag</div>
      </div>
    `;
    bandsGrid.appendChild(card);
  });
}

btnTriggerPrint?.addEventListener('click', () => {
  if (currentSheetFormat === 'avery') {
    document.body.classList.add('avery-mode');
    window.print();
    setTimeout(() => document.body.classList.remove('avery-mode'), 500);
  } else {
    window.print();
  }
});

btnClosePrintSheet?.addEventListener('click', () => {
  printSheetArea.style.display = 'none';
});

// --- Incident Timeline & Follow-up ---

async function checkTimelineAuth() {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  if (api.getMonitorToken()) {
    timelineAuthHelper.classList.add('hidden');
    return;
  }

  // Attempt auto-join if monitorCode is saved
  if (session.monitorCode) {
    try {
      await api.joinMonitor(session.eventId, { monitorCode: session.monitorCode, name: 'Organizer Admin' });
      timelineAuthHelper.classList.add('hidden');
      return;
    } catch {}
  }

  timelineAuthHelper.classList.remove('hidden');
}

btnConnectTimelineMonitor?.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  const code = timelineMonitorCodeInput.value.trim().toUpperCase();
  if (!code) {
    showFlash('Please enter the 6-character monitor code', 'amber');
    return;
  }

  try {
    await api.joinMonitor(session.eventId, { monitorCode: code, name: 'Organizer Admin' });
    api.saveAdminSession({ eventId: session.eventId, adminPin: session.pin, monitorCode: code });
    timelineAuthHelper.classList.add('hidden');
    showFlash('Roster search connected', 'green');
    if (timelineSearchInput.value.trim()) {
      triggerGuestSearch(timelineSearchInput.value.trim());
    }
  } catch (err) {
    showFlash(err.message || 'Invalid monitor code', 'red');
  }
});

timelineSearchInput?.addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  const q = e.target.value.trim();

  if (!q) {
    timelineSearchResults.classList.add('hidden');
    timelineSearchResults.innerHTML = '';
    return;
  }

  searchDebounceTimer = setTimeout(() => {
    triggerGuestSearch(q);
  }, 200);
});

async function triggerGuestSearch(query) {
  try {
    await checkTimelineAuth();
    if (!api.getMonitorToken()) return;

    const guests = await api.searchGuests(query);
    renderSearchResults(guests);
  } catch (err) {
    console.error('Guest search error:', err);
  }
}

function renderSearchResults(guests) {
  timelineSearchResults.innerHTML = '';
  if (!guests || guests.length === 0) {
    timelineSearchResults.innerHTML = `
      <div style="padding: 0.75rem 1rem; color: var(--text-muted); font-size: 0.9rem;">
        No guests found matching search
      </div>
    `;
    timelineSearchResults.classList.remove('hidden');
    return;
  }

  guests.forEach(guest => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const statusBadge = guest.inside
      ? '<span class="badge badge-green" style="font-size: 0.75rem;">Inside</span>'
      : '<span class="badge badge-muted" style="font-size: 0.75rem;">Outside</span>';

    item.innerHTML = `
      <div>
        <span class="search-result-name">${guest.name}</span>
        ${guest.band ? `<span class="band-chip" style="margin-left: 0.5rem; font-size: 0.8rem;">${guest.band}</span>` : ''}
      </div>
      <div>${statusBadge}</div>
    `;

    item.addEventListener('click', () => {
      timelineSearchResults.classList.add('hidden');
      timelineSearchInput.value = guest.name;
      loadGuestTimeline(guest.id);
    });

    timelineSearchResults.appendChild(item);
  });

  timelineSearchResults.classList.remove('hidden');
}

// Close search dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tab-timeline')) {
    timelineSearchResults?.classList.add('hidden');
  }
});

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
  const band = data.band;
  const events = data.events || [];
  const leftWith = data.leftWith || [];
  const lastSeen = data.lastSeenInsideAt;

  tlGuestName.textContent = g.name || 'Guest';
  tlGuestMeta.textContent = `Email: ${g.email || 'None on file'} · Phone: ${g.phone || 'None on file'}`;

  // Band Chip
  if (band && band.shortCode) {
    tlBandChip.textContent = `Band: ${band.shortCode}`;
    tlBandChip.classList.remove('hidden');
  } else {
    tlBandChip.textContent = 'No band assigned';
  }

  // Age & State Badges
  if (g.over21 !== undefined) {
    tlAgeBadge.className = g.over21 ? 'badge badge-green' : 'badge badge-red';
    tlAgeBadge.textContent = g.over21 ? '21+ Verified' : 'Under 21';
    tlAgeBadge.classList.remove('hidden');
  } else {
    tlAgeBadge.classList.add('hidden');
  }

  if (g.idState) {
    tlStateBadge.className = 'badge badge-muted';
    tlStateBadge.textContent = `State: ${g.idState}`;
    tlStateBadge.classList.remove('hidden');
  } else {
    tlStateBadge.classList.add('hidden');
  }

  // Last Seen Inside Line (prominent)
  if (lastSeen) {
    tlLastSeenVal.textContent = api.formatDateTime(lastSeen);
  } else {
    tlLastSeenVal.textContent = 'Not recorded inside tonight';
  }

  // Left With Companions
  if (Array.isArray(leftWith) && leftWith.length > 0) {
    const companionStrings = leftWith.map(c => c.phone ? `${c.name} (${c.phone})` : c.name);
    tlCompanionsList.textContent = companionStrings.join(' · ');
    tlCompanionsCard.classList.remove('hidden');
  } else {
    tlCompanionsCard.classList.add('hidden');
  }

  // Vertical Timeline Activity Flow
  tlEventsContainer.innerHTML = '';
  if (events.length === 0) {
    tlEventsContainer.innerHTML = `
      <p class="text-muted" style="padding: 1rem 0;">No door or exit activity recorded for this guest yet.</p>
    `;
  } else {
    events.forEach(ev => {
      const step = document.createElement('div');
      step.className = `tl-step type-${ev.type}`;

      let dotChar = '•';
      let title = 'Activity';
      let detailHtml = '';

      switch (ev.type) {
        case 'id_check':
          dotChar = '🪪';
          title = 'ID Scanned & Checked';
          const ageTag = ev.detail?.over21 ? '<span class="badge badge-green">21+</span>' : '<span class="badge badge-red">Under 21</span>';
          detailHtml = `Age verification: ${ageTag} ${g.idState ? `(${g.idState} license)` : ''}`;
          break;

        case 'in':
          dotChar = '🟢';
          title = 'Checked IN (Door Entry)';
          detailHtml = `Door scan IN by monitor <strong>${ev.detail?.monitorName || 'Door'}</strong> · Band <strong>${ev.detail?.band || band?.shortCode || '—'}</strong>`;
          break;

        case 'out':
          dotChar = '🚪';
          title = 'Scanned OUT';
          detailHtml = `Door scan OUT by monitor <strong>${ev.detail?.monitorName || 'Door'}</strong> · Band <strong>${ev.detail?.band || band?.shortCode || '—'}</strong>`;
          break;

        case 'departure':
          dotChar = '👥';
          title = 'Left Venue (Departure Group)';
          const withList = Array.isArray(ev.detail?.leftWith) && ev.detail.leftWith.length > 0
            ? `Left together with: <strong style="color: var(--accent-amber);">${ev.detail.leftWith.join(', ')}</strong>`
            : 'Left alone';
          detailHtml = `${withList} · Band <strong>${ev.detail?.band || band?.shortCode || '—'}</strong>`;
          break;
      }

      step.innerHTML = `
        <div class="tl-step-dot">${dotChar}</div>
        <div class="tl-step-header">
          <span class="tl-step-title">${title}</span>
          <span class="tl-step-time">${api.formatDateTime(ev.at)}</span>
        </div>
        <div class="tl-step-detail">${detailHtml}</div>
      `;

      tlEventsContainer.appendChild(step);
    });
  }

  // Print Meta
  if (tlPrintMeta) {
    tlPrintMeta.textContent = `Generated: ${new Date().toLocaleString()} · Event: ${currentEvent?.name || ''}`;
  }

  timelineCard.classList.remove('hidden');
  timelineCard.scrollIntoView({ behavior: 'smooth' });
}

btnCloseTimeline?.addEventListener('click', () => {
  timelineCard.classList.add('hidden');
});

btnPrintTimeline?.addEventListener('click', () => {
  document.body.classList.add('timeline-print-mode');
  window.print();
  setTimeout(() => document.body.classList.remove('timeline-print-mode'), 500);
});

// --- Data Export ---

btnDownloadExportCsv.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  try {
    const csvData = await api.getExportCsv(session.eventId);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `homebound_roster_${session.eventId.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showFlash('export.csv downloaded successfully', 'green');
  } catch (err) {
    showFlash(err.message || 'Export failed', 'red');
  }
});

// --- End Event ---

btnEndEvent.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  if (confirm('Are you sure you want to end this event now? This marks the event complete and schedules automatic data deletion in 30 days.')) {
    try {
      await api.endEvent(session.eventId);
      showFlash('Event ended. 30-day retention countdown started.', 'amber');
      await loadEvent(session.eventId);
    } catch (err) {
      showFlash(err.message || 'Failed to end event', 'red');
    }
  }
});

// Start
init();
