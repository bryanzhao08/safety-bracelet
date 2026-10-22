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

// Creation & Login Forms
const createEventForm = document.getElementById('create-event-form');
const createName = document.getElementById('create-name');
const createStarts = document.getElementById('create-starts');
const createEnds = document.getElementById('create-ends');

const loginEventForm = document.getElementById('login-event-form');
const adminEventIdInput = document.getElementById('admin-event-id');
const adminPinInput = document.getElementById('admin-pin');

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
const btnDownloadNfcCsv = document.getElementById('btn-download-nfc-csv');
const printSheetArea = document.getElementById('print-sheet-area');
const bandsGrid = document.getElementById('bands-grid');
const btnTriggerPrint = document.getElementById('btn-trigger-print');
const btnClosePrintSheet = document.getElementById('btn-close-print-sheet');

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

// State
let currentEvent = null;
let selectedCsvText = null;
let currentBands = [];

function showFlash(message, type = 'green', duration = 3000) {
  flashBanner.textContent = message;
  flashBanner.className = `flash-banner flash-${type} show`;
  setTimeout(() => {
    flashBanner.className = `flash-banner flash-${type}`;
  }, duration);
}

// --- Init & Auth ---

async function init() {
  // Set default datetime inputs to now and tomorrow
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

    secretsModal.classList.add('open');

    // Also prefill current session
    api.saveAdminSession({
      eventId: res.eventId,
      adminPin: res.adminPin,
      monitorCode: res.monitorCode,
    });
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

// Clipboard copy helper
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

  try {
    const data = await api.getEvent(eventId, pin);
    api.saveAdminSession({ eventId, adminPin: pin });
    currentEvent = data.event;
    renderEventStats(data);
    showAdminView();
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

  // Update download link for NFC CSV
  btnDownloadNfcCsv.href = `/api/events/${encodeURIComponent(e.id)}/bands.csv`;
}

// --- Tabs Navigation ---

adminTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    adminTabs.forEach(t => t.classList.remove('active'));
    adminSections.forEach(s => s.classList.remove('active'));

    tab.classList.add('active');
    const targetSection = document.getElementById(`tab-${tab.dataset.tab}`);
    if (targetSection) targetSection.classList.add('active');
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
    renderPrintableBands(currentBands);
    printSheetArea.style.display = 'block';
    await loadEvent(session.eventId);
  } catch (err) {
    showFlash(err.message || 'Failed to generate bands', 'red');
  }
});

// --- Printable Band Sheet ---

btnViewSheet.addEventListener('click', async () => {
  const session = api.getAdminSession();
  if (!session?.eventId) return;

  // If no bands in memory, fetch bands CSV and parse
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
      return;
    }
  }

  if (currentBands.length === 0) {
    showFlash('No bands generated for this event yet', 'amber');
    return;
  }

  renderPrintableBands(currentBands);
  printSheetArea.style.display = 'block';
  printSheetArea.scrollIntoView({ behavior: 'smooth' });
});

function renderPrintableBands(bands) {
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

btnTriggerPrint.addEventListener('click', () => {
  window.print();
});

btnClosePrintSheet.addEventListener('click', () => {
  printSheetArea.style.display = 'none';
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
