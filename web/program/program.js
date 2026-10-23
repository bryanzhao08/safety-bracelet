// web/program/program.js - Homebound Band Programmer Controller
import * as api from '../shared/api.js';

const hasWebNfc = 'NDEFReader' in window;

// DOM Elements
const flashBanner = document.getElementById('flash-banner');
const deviceWarning = document.getElementById('device-warning');
const btnDownloadCsvWarning = document.getElementById('btn-download-csv-warning');
const btnCopyCsvWarning = document.getElementById('btn-copy-csv-warning');

const loadSection = document.getElementById('load-section');
const programmerSection = document.getElementById('programmer-section');

const fetchBandsForm = document.getElementById('fetch-bands-form');
const progEventId = document.getElementById('prog-event-id');
const progAdminPin = document.getElementById('prog-admin-pin');
const fetchError = document.getElementById('fetch-error');
const btnFetchBands = document.getElementById('btn-fetch-bands');

const dropZone = document.getElementById('drop-zone');
const csvFileInput = document.getElementById('csv-file-input');
const btnBrowseCsv = document.getElementById('btn-browse-csv');

// Programmer Elements
const progTitle = document.getElementById('prog-title');
const progPercent = document.getElementById('prog-percent');
const progFill = document.getElementById('prog-fill');
const chipWritten = document.getElementById('chip-written');
const chipSkipped = document.getElementById('chip-skipped');
const chipRemaining = document.getElementById('chip-remaining');

const stageCard = document.getElementById('stage-card');
const stageVisual = document.getElementById('stage-visual');
const stagePrompt = document.getElementById('stage-prompt');
const stageCode = document.getElementById('stage-code');
const stageUrl = document.getElementById('stage-url');
const stageStatusMsg = document.getElementById('stage-status-msg');

const btnSkip = document.getElementById('btn-skip');
const btnRewrite = document.getElementById('btn-rewrite');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const checkAutoAdvance = document.getElementById('check-auto-advance');
const btnReloadCsv = document.getElementById('btn-reload-csv');

const totalBandsCount = document.getElementById('total-bands-count');
const stickersGrid = document.getElementById('stickers-grid');
const filterAll = document.getElementById('filter-all');
const filterPending = document.getElementById('filter-pending');

// State
let rawCsvContent = '';
let bands = []; // [{ shortCode, url, status: 'pending'|'written'|'skipped' }]
let currentIndex = 0;
let autoAdvance = true;
let currentFilter = 'all'; // 'all' | 'pending'
let ndefReader = null;
let isWriting = false;
let activeWriteController = null;

// --- Feedback ---

function showFlash(message, type = 'green', duration = 2500) {
  if (!flashBanner) return;
  flashBanner.textContent = message;
  flashBanner.className = `flash-banner flash-${type} show`;
  if (navigator.vibrate) {
    if (type === 'green') navigator.vibrate([40, 30, 40]);
    else navigator.vibrate([60, 40, 60]);
  }
  setTimeout(() => {
    flashBanner.className = `flash-banner flash-${type}`;
  }, duration);
}

// --- Initialization ---

function init() {
  // Check Web NFC support
  if (!hasWebNfc) {
    deviceWarning.classList.remove('hidden');
  }

  // Auto-fill from localStorage or URL query parameters
  const params = new URLSearchParams(window.location.search);
  const queryEvent = params.get('event') || params.get('eventId');
  const queryPin = params.get('pin');

  const storedEvent = localStorage.getItem('hb_admin_event_id');
  const storedPin = localStorage.getItem('hb_admin_pin');

  if (queryEvent) progEventId.value = queryEvent;
  else if (storedEvent) progEventId.value = storedEvent;

  if (queryPin) progAdminPin.value = queryPin;
  else if (storedPin) progAdminPin.value = storedPin;

  // Setup CSV Drag & Drop
  setupDragAndDrop();

  // Setup Warning Buttons
  btnDownloadCsvWarning.addEventListener('click', downloadCsvFile);
  btnCopyCsvWarning.addEventListener('click', copyCsvData);
}

// --- Drag & Drop / File Input ---

function setupDragAndDrop() {
  btnBrowseCsv.addEventListener('click', () => csvFileInput.click());

  csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result;
    if (typeof text === 'string') {
      loadCsvText(text, file.name);
    }
  };
  reader.readAsText(file);
}

// --- Fetch CSV from Server ---

fetchBandsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  fetchError.classList.add('hidden');
  const eventId = progEventId.value.trim();
  const pin = progAdminPin.value.trim();

  btnFetchBands.disabled = true;
  btnFetchBands.textContent = 'Fetching bands...';

  try {
    api.saveAdminSession({ eventId, adminPin: pin });
    const csvText = await api.getBandsCsv(eventId);
    loadCsvText(csvText, `bands-${eventId.slice(0, 8)}.csv`);
  } catch (err) {
    fetchError.textContent = err.message || 'Failed to fetch bands CSV. Check Event ID and Admin PIN.';
    fetchError.classList.remove('hidden');
  } finally {
    btnFetchBands.disabled = false;
    btnFetchBands.textContent = 'Fetch Bands from Event';
  }
});

// --- CSV Parsing ---

function parseBandsCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const parsed = [];

  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 2) continue;

    const [col0, col1] = parts;
    // Check if header row
    if (col0.toLowerCase().includes('shortcode') || col0.toLowerCase().includes('code') || col0.toLowerCase() === 'url') {
      continue;
    }

    let shortCode = '';
    let url = '';

    if (col1.startsWith('http://') || col1.startsWith('https://') || col1.startsWith('/')) {
      shortCode = col0.toUpperCase();
      url = col1;
    } else if (col0.startsWith('http://') || col0.startsWith('https://') || col0.startsWith('/')) {
      shortCode = col1.toUpperCase();
      url = col0;
    } else {
      shortCode = col0.toUpperCase();
      url = col1;
    }

    // Normalize relative URL
    if (url.startsWith('/')) {
      url = window.location.origin + url;
    }

    if (shortCode && url) {
      parsed.push({
        shortCode,
        url,
        status: 'pending', // 'pending' | 'written' | 'skipped'
      });
    }
  }

  return parsed;
}

function loadCsvText(text, filename = 'bands.csv') {
  rawCsvContent = text;
  const parsed = parseBandsCsv(text);

  if (parsed.length === 0) {
    showFlash('No valid bands found in CSV', 'amber');
    return;
  }

  bands = parsed;
  currentIndex = 0;

  loadSection.classList.add('hidden');
  programmerSection.classList.remove('hidden');
  totalBandsCount.textContent = bands.length;

  showFlash(`Loaded ${bands.length} wristbands`, 'green');
  renderCurrentBand();

  if (hasWebNfc) {
    armNfcWriter();
  }
}

// --- CSV Download & Copy Helpers ---

function downloadCsvFile() {
  if (!rawCsvContent) {
    showFlash('Load or fetch bands first to download CSV', 'amber');
    return;
  }
  const blob = new Blob([rawCsvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bands.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyCsvData() {
  if (!rawCsvContent) {
    showFlash('Load or fetch bands first to copy CSV', 'amber');
    return;
  }
  try {
    await navigator.clipboard.writeText(rawCsvContent);
    showFlash('Copied CSV to clipboard', 'green');
  } catch {
    showFlash('Could not copy to clipboard', 'amber');
  }
}

// --- Programmer UI Rendering ---

function renderCurrentBand() {
  if (bands.length === 0) return;
  const band = bands[currentIndex];

  // Title & Counts
  progTitle.textContent = `Sticker ${currentIndex + 1} of ${bands.length}`;
  const writtenCount = bands.filter(b => b.status === 'written').length;
  const skippedCount = bands.filter(b => b.status === 'skipped').length;
  const remainingCount = bands.length - writtenCount - skippedCount;

  const pct = Math.round((writtenCount / bands.length) * 100);
  progPercent.textContent = `${pct}%`;
  progFill.style.width = `${pct}%`;

  chipWritten.textContent = `✓ ${writtenCount} written`;
  chipSkipped.textContent = `⏭ ${skippedCount} skipped`;
  chipRemaining.textContent = `⏳ ${remainingCount} remaining`;

  // Stage Card
  stageCode.textContent = `#${band.shortCode}`;
  stageUrl.textContent = band.url;

  if (band.status === 'written') {
    stageCard.className = 'stage-card stage-success';
    stageVisual.textContent = '✓';
    stagePrompt.textContent = `✓ Sticker #${band.shortCode} programmed`;
    stageStatusMsg.textContent = 'Already written. Click Rewrite to program again.';
    stageStatusMsg.style.color = 'var(--accent-green)';
  } else if (band.status === 'skipped') {
    stageCard.className = 'stage-card';
    stageVisual.textContent = '⏭';
    stagePrompt.textContent = `Sticker #${band.shortCode} (Skipped)`;
    stageStatusMsg.textContent = 'Click Rewrite to program this tag.';
    stageStatusMsg.style.color = 'var(--text-muted)';
  } else {
    stageCard.className = 'stage-card stage-ready';
    stageVisual.textContent = '⚡';
    stagePrompt.textContent = `Hold sticker #${band.shortCode} to the phone`;
    stageStatusMsg.textContent = hasWebNfc
      ? 'Hold blank tag against the back of phone to write'
      : 'Web NFC unavailable on this device';
    stageStatusMsg.style.color = 'var(--accent-amber)';
  }

  // Prev / Next button states
  btnPrev.disabled = currentIndex === 0;
  btnNext.disabled = currentIndex === bands.length - 1;

  renderStickersGrid();
}

function renderStickersGrid() {
  stickersGrid.innerHTML = '';
  const filtered = bands.map((b, idx) => ({ ...b, idx })).filter(b => {
    if (currentFilter === 'pending') return b.status === 'pending';
    return true;
  });

  filtered.forEach(band => {
    const pill = document.createElement('div');
    let statusClass = band.status === 'written' ? 'written' : band.status === 'skipped' ? 'skipped' : '';
    if (band.idx === currentIndex) statusClass += ' active';
    pill.className = `sticker-pill ${statusClass}`.trim();

    const icon = band.status === 'written' ? '✓' : band.status === 'skipped' ? '⏭' : '';
    pill.innerHTML = `<span>#${band.shortCode}</span><span>${icon}</span>`;

    pill.addEventListener('click', () => {
      currentIndex = band.idx;
      renderCurrentBand();
      if (hasWebNfc) armNfcWriter();
    });

    stickersGrid.appendChild(pill);
  });
}

// Filter tabs
filterAll.addEventListener('click', () => {
  currentFilter = 'all';
  filterAll.classList.add('btn-primary');
  filterAll.classList.remove('btn-secondary');
  filterPending.classList.remove('btn-primary');
  filterPending.classList.add('btn-secondary');
  renderStickersGrid();
});

filterPending.addEventListener('click', () => {
  currentFilter = 'pending';
  filterPending.classList.add('btn-primary');
  filterPending.classList.remove('btn-secondary');
  filterAll.classList.remove('btn-primary');
  filterAll.classList.add('btn-secondary');
  renderStickersGrid();
});

// --- Web NFC Writer Logic ---

async function armNfcWriter() {
  if (!hasWebNfc || bands.length === 0) return;
  const currentBand = bands[currentIndex];
  if (!currentBand) return;

  // Cancel any in-flight write operation
  if (activeWriteController) {
    try {
      activeWriteController.abort();
    } catch {
      // Ignore
    }
  }

  activeWriteController = new AbortController();
  const signal = activeWriteController.signal;

  try {
    if (!ndefReader) {
      ndefReader = new window.NDEFReader();
    }

    stageStatusMsg.textContent = `Ready: hold sticker #${currentBand.shortCode} to the phone`;
    stageStatusMsg.style.color = 'var(--accent-amber)';

    // Write NDEF URL record
    await ndefReader.write(
      {
        records: [
          {
            recordType: 'url',
            data: currentBand.url,
          },
        ],
      },
      { signal }
    );

    // If successfully written:
    handleWriteSuccess(currentBand);
  } catch (err) {
    if (signal.aborted) return; // User switched tags or skipped
    console.warn('NFC write error', err);
    stageCard.className = 'stage-card stage-error';
    stageStatusMsg.textContent = `Write failed: ${err.message || 'Tag disconnected'}. Tap #${currentBand.shortCode} again.`;
    stageStatusMsg.style.color = 'var(--accent-red)';
    showFlash(`Write error: tap #${currentBand.shortCode} firmly`, 'amber');
  }
}

function handleWriteSuccess(band) {
  band.status = 'written';

  // Haptic feedback
  if (navigator.vibrate) {
    navigator.vibrate([60, 40, 60]);
  }

  showFlash(`✓ #${band.shortCode} written`, 'green');
  renderCurrentBand();

  // Auto-advance if enabled and not at the last sticker
  if (checkAutoAdvance.checked) {
    setTimeout(() => {
      if (currentIndex < bands.length - 1) {
        currentIndex++;
        renderCurrentBand();
        if (hasWebNfc) armNfcWriter();
      } else {
        showFlash('🎉 All wristbands programmed!', 'green', 4000);
      }
    }, 600);
  }
}

// --- Controls Event Handlers ---

btnSkip.addEventListener('click', () => {
  if (bands.length === 0) return;
  bands[currentIndex].status = 'skipped';
  showFlash(`Skipped #${bands[currentIndex].shortCode}`, 'amber');

  // Find next unwritten band
  const nextPending = bands.findIndex((b, i) => i > currentIndex && b.status === 'pending');
  if (nextPending !== -1) {
    currentIndex = nextPending;
  } else if (currentIndex < bands.length - 1) {
    currentIndex++;
  }

  renderCurrentBand();
  if (hasWebNfc) armNfcWriter();
});

btnRewrite.addEventListener('click', () => {
  if (bands.length === 0) return;
  bands[currentIndex].status = 'pending';
  renderCurrentBand();
  if (hasWebNfc) armNfcWriter();
});

btnPrev.addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    renderCurrentBand();
    if (hasWebNfc) armNfcWriter();
  }
});

btnNext.addEventListener('click', () => {
  if (currentIndex < bands.length - 1) {
    currentIndex++;
    renderCurrentBand();
    if (hasWebNfc) armNfcWriter();
  }
});

btnReloadCsv.addEventListener('click', () => {
  if (confirm('Load a new bands CSV?')) {
    programmerSection.classList.add('hidden');
    loadSection.classList.remove('hidden');
    bands = [];
    rawCsvContent = '';
  }
});

// Run init
init();
