// web/door/door.js - Door Scanner Controller for Homebound v2
import * as api from '/shared/api.js';
import * as offline from '/door/offline.js';
import { parseAamva } from '/shared/aamva.js';
import { parseScannedValue } from '/shared/qr-scanner.js';

// DOM Elements
const flashBanner = document.getElementById('flash-banner');
const joinView = document.getElementById('join-view');
const doorView = document.getElementById('door-view');
const joinForm = document.getElementById('join-form');
const joinEventId = document.getElementById('join-event-id');
const joinMonitorCode = document.getElementById('join-monitor-code');
const joinName = document.getElementById('join-name');
const joinError = document.getElementById('join-error');

const doorEventName = document.getElementById('door-event-name');
const doorMonitorName = document.getElementById('door-monitor-name');
const btnLeaveShift = document.getElementById('btn-leave-shift');

const btnModeIn = document.getElementById('btn-mode-in');
const btnModeOut = document.getElementById('btn-mode-out');
const inModeContainer = document.getElementById('in-mode-container');
const outModeContainer = document.getElementById('out-mode-container');

const nfcBar = document.getElementById('nfc-bar');
const nfcLabel = document.getElementById('nfc-label');
const nfcDot = document.getElementById('nfc-dot');

const offlineBar = document.getElementById('offline-bar');
const offlineDot = document.getElementById('offline-dot');
const offlineText = document.getElementById('offline-text');
const btnSyncNow = document.getElementById('btn-sync-now');

const btnOpenIdScanner = document.getElementById('btn-open-id-scanner');
const idResultContainer = document.getElementById('id-result-container');
const idBadgeWrap = document.getElementById('id-badge-wrap');
const idGuestName = document.getElementById('id-guest-name');
const idMetaLine = document.getElementById('id-meta-line');
const idDuplicateWarning = document.getElementById('id-duplicate-warning');
const idCandidatesContainer = document.getElementById('id-candidates-container');
const idCandidatesList = document.getElementById('id-candidates-list');
const btnCancelId = document.getElementById('btn-cancel-id');

const btnOpenGuestSearch = document.getElementById('btn-open-guest-search');
const btnOpenQrScanner = document.getElementById('btn-open-qr-scanner');
const btnOpenQrScannerOut = document.getElementById('btn-open-qr-scanner-out');
const manualCodeForm = document.getElementById('manual-code-form');
const manualCodeInput = document.getElementById('manual-code-input');
const manualCodeFormOut = document.getElementById('manual-code-form-out');
const manualCodeInputOut = document.getElementById('manual-code-input-out');

// Leaving Tray Elements
const trayCount = document.getElementById('tray-count');
const trayCountdownText = document.getElementById('tray-countdown-text');
const trayTimerBar = document.getElementById('tray-timer-bar');
const leavingGuestList = document.getElementById('leaving-guest-list');
const trayEmptyMsg = document.getElementById('tray-empty-msg');
const btnLeaveAlone = document.getElementById('btn-leave-alone');
const btnLeaveTogether = document.getElementById('btn-leave-together');

// Camera Modal Elements
const cameraModal = document.getElementById('camera-modal');
const scannerVideo = document.getElementById('scanner-video');
const scannerGuideText = document.getElementById('scanner-guide-text');
const btnTorch = document.getElementById('btn-torch');
const btnCloseCamera = document.getElementById('btn-close-camera');

// Guest Search Modal Elements
const guestSearchModal = document.getElementById('guest-search-modal');
const guestSearchTitle = document.getElementById('guest-search-title');
const guestSearchInput = document.getElementById('guest-search-input');
const guestSearchResults = document.getElementById('guest-search-results');
const btnCloseGuestSearch = document.getElementById('btn-close-guest-search');
const btnOpenAddWalkin = document.getElementById('btn-open-add-walkin');

// Walkin Modal Elements
const walkinModal = document.getElementById('walkin-modal');
const walkinForm = document.getElementById('walkin-form');
const walkinName = document.getElementById('walkin-name');
const walkinEmail = document.getElementById('walkin-email');
const walkinPhone = document.getElementById('walkin-phone');
const btnCloseWalkin = document.getElementById('btn-close-walkin');
const btnCancelWalkin = document.getElementById('btn-cancel-walkin');

// State
let currentMode = 'in'; // 'in' or 'out'
let pendingIdGuest = null;
let unlinkedBand = null; // { bandToken?, shortCode }
let leavingTray = []; // [{ bandToken?, shortCode, name }]
let trayTimer = null;
let trayTimeLeft = 30;

// Local offline state tracking
const localInsideBands = new Set();
const localGuestMap = new Map();

// Register Service Worker for offline door page availability
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/door/sw.js')
    .catch(err => console.warn('SW registration failed', err));
}

// Initialize offline queue & subscribe to queue changes
offline.initOfflineQueue();
offline.onQueueChange(({ count, isSyncing }) => {
  if (!offlineBar) return;
  if (count > 0) {
    offlineBar.classList.remove('hidden');
    if (isSyncing) {
      offlineText.textContent = `Syncing offline scans (${count} waiting)...`;
      offlineDot.classList.add('syncing');
    } else {
      offlineText.textContent = `Saved offline (${count} waiting)`;
      offlineDot.classList.remove('syncing');
    }
  } else {
    offlineBar.classList.add('hidden');
    offlineDot.classList.remove('syncing');
  }
});

btnSyncNow?.addEventListener('click', () => {
  offline.flushQueue();
});

// Camera state
let cameraActive = false;
let cameraStream = null;
let cameraTrack = null;
let cameraMode = 'id'; // 'id' (pdf417) or 'band' (qr)
let zxingReader = null;
let animFrameId = null;

// --- Flash Messages & Feedback ---

function showFlash(message, type = 'green', duration = 2500) {
  flashBanner.textContent = message;
  flashBanner.className = `flash-banner flash-${type} show`;
  if (navigator.vibrate) {
    if (type === 'green') navigator.vibrate([40, 30, 40]);
    else if (type === 'amber') navigator.vibrate([60, 40, 60]);
    else navigator.vibrate([100, 50, 100]);
  }
  setTimeout(() => {
    flashBanner.className = `flash-banner flash-${type}`;
  }, duration);
}

// --- Mode Switching ---

function setMode(mode) {
  currentMode = mode;
  if (mode === 'in') {
    btnModeIn.className = 'mode-btn active-in';
    btnModeOut.className = 'mode-btn';
    inModeContainer.classList.remove('hidden');
    outModeContainer.classList.add('hidden');
  } else {
    btnModeIn.className = 'mode-btn';
    btnModeOut.className = 'mode-btn active-out';
    inModeContainer.classList.add('hidden');
    outModeContainer.classList.remove('hidden');
  }
}

btnModeIn.addEventListener('click', () => setMode('in'));
btnModeOut.addEventListener('click', () => setMode('out'));

// --- Shift Join & Session Management ---

async function initSession() {
  // Normalize /door to /door/ so service worker scope covers it
  if (window.location.pathname === '/door') {
    window.history.replaceState({}, '', '/door/' + window.location.search);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const prefillToken = urlParams.get('bandToken');
  const urlEventId = urlParams.get('event') || urlParams.get('eventId');
  const urlCode = urlParams.get('code');

  if (urlEventId && joinEventId) joinEventId.value = urlEventId;
  if (urlCode && joinMonitorCode) joinMonitorCode.value = urlCode;

  const session = api.getMonitorSession();
  if (session && session.token && session.eventId) {
    doorEventName.textContent = session.eventName || 'Homebound Event';
    doorMonitorName.textContent = `Monitor: ${session.name || 'Active'}`;
    joinView.classList.add('hidden');
    doorView.classList.remove('hidden');

    initNfc();

    if (prefillToken) {
      handleBandScanned({ bandToken: prefillToken });
      window.history.replaceState({}, '', '/door/');
    }
  } else {
    joinView.classList.remove('hidden');
    doorView.classList.add('hidden');
  }
}

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  joinError.classList.add('hidden');
  const eventId = joinEventId.value.trim();
  const monitorCode = joinMonitorCode.value.trim().toUpperCase();
  const name = joinName.value.trim();

  try {
    const res = await api.joinMonitor(eventId, { monitorCode, name });
    doorEventName.textContent = res.event?.name || 'Homebound Event';
    doorMonitorName.textContent = `Monitor: ${name}`;
    joinView.classList.add('hidden');
    doorView.classList.remove('hidden');
    initNfc();
  } catch (err) {
    joinError.textContent = err.message || 'Failed to join shift. Check Event ID and Monitor Code.';
    joinError.classList.remove('hidden');
  }
});

btnLeaveShift.addEventListener('click', () => {
  if (confirm('Leave door shift?')) {
    api.clearMonitorSession();
    window.location.reload();
  }
});

// --- Web NFC Integration ---

async function initNfc() {
  if (!('NDEFReader' in window)) {
    nfcLabel.textContent = '📷 Camera QR & Short Codes Active';
    nfcDot.style.backgroundColor = 'var(--text-muted)';
    nfcDot.style.animation = 'none';
    return;
  }

  try {
    const ndef = new window.NDEFReader();
    await ndef.scan();
    nfcLabel.textContent = '⚡ Web NFC Active — Tap tag to phone';
    nfcDot.style.backgroundColor = 'var(--accent-green)';

    ndef.addEventListener('reading', ({ message }) => {
      for (const record of message.records) {
        let text = '';
        if (record.recordType === 'url' || record.recordType === 'text') {
          const decoder = new TextDecoder(record.encoding || 'utf-8');
          text = decoder.decode(record.data);
          const parsed = parseScannedValue(text);
          if (parsed) {
            handleBandScanned(parsed);
            break;
          }
        }
      }
    });

    ndef.addEventListener('readingerror', () => {
      showFlash('NFC read error. Try tapping again.', 'amber');
    });
  } catch (err) {
    nfcLabel.textContent = 'NFC Permission Required or Unavailable';
    nfcDot.style.backgroundColor = 'var(--text-muted)';
  }
}

// --- Universal Band Scan Handler (NFC, QR, Manual Code) ---

async function handleBandScanned({ bandToken, shortCode }) {
  if (currentMode === 'in') {
    await handleCheckInBand({ bandToken, shortCode });
  } else {
    await handleDepartureBand({ bandToken, shortCode });
  }
}

// --- Check-in Handler (IN Mode) ---

async function handleCheckInBand({ bandToken, shortCode }) {
  const session = api.getMonitorSession();
  const token = session?.token;
  const key = shortCode || bandToken;

  // Case A: ID was scanned first, guest is pending link
  if (pendingIdGuest) {
    if (!pendingIdGuest.id) {
      showFlash('Please select a matching guest from the list first', 'amber');
      return;
    }
    const guest = pendingIdGuest;
    // Instant local UI feedback
    showFlash(`✓ ${guest.name} in`, 'green');
    clearPendingId();
    if (key) {
      localInsideBands.add(key);
      localGuestMap.set(key, guest.name);
    }

    const res = await offline.executeOrQueueScan({
      bandToken,
      shortCode,
      direction: 'in',
      guestId: guest.id,
    }, token);

    if (!res.queued && res.error) {
      if (res.status === 409 && res.error === 'band_already_linked') {
        showFlash('Band already linked to another guest', 'amber');
      } else {
        showFlash(res.message || 'Failed to link band', 'red');
      }
    }
    return;
  }

  // Case B: Direct band scan without prior ID
  const knownName = localGuestMap.get(key);
  const alreadyInsideLocally = key && localInsideBands.has(key);

  if (alreadyInsideLocally) {
    showFlash(`⚠️ Already inside: ${knownName || key}`, 'amber');
  } else {
    showFlash(`✓ ${knownName || key || 'Guest'} in`, 'green');
  }

  const res = await offline.executeOrQueueScan({
    bandToken,
    shortCode,
    direction: 'in',
  }, token);

  if (res.queued) {
    if (key) localInsideBands.add(key);
    return;
  }

  if (res.data?.needsGuest) {
    // Unlinked band! Open guest list to link.
    if (key) localInsideBands.delete(key);
    unlinkedBand = { bandToken, shortCode: res.data.band?.shortCode || shortCode };
    openGuestSearch(`Link Band ${unlinkedBand.shortCode || ''}`);
    return;
  }

  if (res.data?.warning === 'already_inside') {
    if (key) localInsideBands.add(key);
    showFlash(`⚠️ Already inside: ${res.data.guest?.name || 'Guest'}`, 'amber');
    return;
  }

  if (res.error) {
    if (key && !alreadyInsideLocally) localInsideBands.delete(key);
    if (res.status === 409 && res.error === 'band_already_linked') {
      showFlash('Band already linked to another guest', 'amber');
    } else {
      showFlash(res.message || 'Check-in failed', 'red');
    }
    return;
  }

  if (res.data?.guest?.name) {
    if (key) {
      localInsideBands.add(key);
      localGuestMap.set(key, res.data.guest.name);
    }
    showFlash(`✓ ${res.data.guest.name} in`, 'green');
  }
}

// --- ID Scanning Flow (AAMVA PDF417) ---

btnOpenIdScanner.addEventListener('click', () => {
  openCameraScanner('id');
});

function calculateAge(dobStr) {
  if (!dobStr) return null;
  const parts = dobStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [y, m, d] = parts;
  const today = new Date();
  let age = today.getFullYear() - y;
  const mDiff = (today.getMonth() + 1) - m;
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d)) {
    age--;
  }
  return age >= 0 ? age : null;
}

function handleIdBarcodeDecoded(rawText) {
  closeCameraModal();

  const parsed = parseAamva(rawText);
  if (!parsed || (!parsed.firstName && !parsed.lastName)) {
    showFlash('Could not parse driver license barcode', 'amber');
    return;
  }

  // Never store raw barcode or license number in UI or logs
  sendIdCheckin(parsed);
}

async function sendIdCheckin(parsed) {
  try {
    const res = await api.idCheckin(parsed);
    renderIdResult(parsed, res);
  } catch (err) {
    if (err.status === 409) {
      showFlash('⚠️ ID already verified for this guest', 'amber', 4000);
    } else if (err.status === 400) {
      showFlash(err.message || 'Invalid ID barcode fields', 'amber', 4000);
    } else {
      showFlash(err.message || 'ID check-in failed', 'red', 4000);
    }
  }
}

function renderIdResult(parsed, res) {
  idResultContainer.classList.remove('hidden');

  // Giant Age Badge: 21+ (green), UNDER 21 (red), EXPIRED (amber)
  idBadgeWrap.innerHTML = '';
  const badge = document.createElement('div');
  if (res.expired) {
    badge.className = 'age-badge badge-expired';
    badge.textContent = 'EXPIRED';
  } else if (res.over21) {
    badge.className = 'age-badge badge-21plus';
    badge.textContent = '21+';
  } else {
    badge.className = 'age-badge badge-under21';
    badge.textContent = 'UNDER 21';
  }
  idBadgeWrap.appendChild(badge);

  const displayName = res.guest?.name || [parsed.firstName, parsed.lastName].filter(Boolean).join(' ') || 'Guest';
  idGuestName.textContent = displayName;

  const age = calculateAge(parsed.dob);
  const metaParts = [];
  if (age !== null) metaParts.push(`Age: ${age}`);
  if (parsed.dob) metaParts.push(`DOB: ${parsed.dob}`);
  if (parsed.idState) metaParts.push(`State: ${parsed.idState}`);
  idMetaLine.textContent = metaParts.join(' · ');

  if (res.duplicate) {
    const timeStr = res.duplicate.at ? ` at ${api.formatTime(res.duplicate.at)}` : '';
    idDuplicateWarning.textContent = `⚠️ Duplicate: ID already scanned tonight${timeStr}`;
    idDuplicateWarning.classList.remove('hidden');
  } else {
    idDuplicateWarning.classList.add('hidden');
  }

  if (res.candidates && res.candidates.length > 0) {
    pendingIdGuest = null; // require explicit candidate selection
    idCandidatesContainer.classList.remove('hidden');
    idCandidatesList.innerHTML = '';

    res.candidates.forEach(cand => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.textContent = cand.name;
      btn.addEventListener('click', () => {
        pendingIdGuest = cand;
        idGuestName.textContent = cand.name;
        idCandidatesContainer.classList.add('hidden');
        showFlash(`Selected: ${cand.name}. Tap band now.`, 'green');
      });
      idCandidatesList.appendChild(btn);
    });

    const walkinBtn = document.createElement('button');
    walkinBtn.type = 'button';
    walkinBtn.className = 'btn btn-secondary';
    walkinBtn.style.borderColor = 'var(--accent-amber)';
    walkinBtn.textContent = `＋ Not listed? Add as walk-in ("${displayName}")`;
    walkinBtn.addEventListener('click', async () => {
      const session = api.getMonitorSession();
      if (!session?.eventId) return;
      try {
        const added = await api.addWalkInGuest(session.eventId, { name: displayName });
        pendingIdGuest = added.guest;
        idGuestName.textContent = added.guest.name;
        idCandidatesContainer.classList.add('hidden');
        showFlash(`Created walk-in: ${added.guest.name}. Tap band now.`, 'green');
      } catch (err) {
        showFlash(err.message || 'Failed to create walk-in', 'red');
      }
    });
    idCandidatesList.appendChild(walkinBtn);
  } else {
    idCandidatesContainer.classList.add('hidden');
    pendingIdGuest = res.guest || { name: displayName };
  }
}

function clearPendingId() {
  pendingIdGuest = null;
  idResultContainer.classList.add('hidden');
  idCandidatesContainer.classList.add('hidden');
  idDuplicateWarning.classList.add('hidden');
}

btnCancelId.addEventListener('click', clearPendingId);

// --- Departure Handler (OUT Mode - Leaving Tray) ---

async function handleDepartureBand({ bandToken, shortCode }) {
  const existing = leavingTray.find(item =>
    (bandToken && item.bandToken === bandToken) ||
    (shortCode && item.shortCode === shortCode.toUpperCase())
  );
  if (existing) {
    showFlash(`${existing.name || 'Guest'} already in leaving tray`, 'amber');
    return;
  }

  // Lookup guest name
  let name = shortCode || 'Guest';
  try {
    const guests = await api.searchGuests(shortCode || '');
    const match = guests.find(g => g.band === shortCode?.toUpperCase());
    if (match) name = match.name;
  } catch {
    // Fallback to code
  }

  leavingTray.push({ bandToken, shortCode: shortCode?.toUpperCase(), name });
  renderLeavingTray();
  resetTrayTimer();
}

function renderLeavingTray() {
  trayCount.textContent = leavingTray.length;
  leavingGuestList.innerHTML = '';

  if (leavingTray.length === 0) {
    leavingGuestList.appendChild(trayEmptyMsg);
    btnLeaveAlone.disabled = true;
    btnLeaveTogether.disabled = true;
    stopTrayTimer();
    return;
  }

  btnLeaveAlone.disabled = false;
  btnLeaveTogether.disabled = leavingTray.length < 2;

  leavingTray.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'leaving-guest-item';
    div.innerHTML = `
      <div>
        <span class="leaving-guest-name">${item.name}</span>
        ${item.shortCode ? `<span class="leaving-guest-band">[${item.shortCode}]</span>` : ''}
      </div>
      <button class="btn-remove-tray" title="Remove" type="button">✕</button>
    `;
    div.querySelector('.btn-remove-tray').addEventListener('click', () => {
      leavingTray.splice(index, 1);
      renderLeavingTray();
      if (leavingTray.length > 0) resetTrayTimer();
    });
    leavingGuestList.appendChild(div);
  });
}

function resetTrayTimer() {
  stopTrayTimer();
  trayTimeLeft = 30;
  updateTrayTimerDisplay();

  trayTimer = setInterval(() => {
    trayTimeLeft--;
    updateTrayTimerDisplay();

    if (trayTimeLeft <= 0) {
      stopTrayTimer();
      // Auto-submit: 1 guest -> alone, 2+ guests -> together
      if (leavingTray.length === 1) {
        submitDepartures(false);
      } else if (leavingTray.length >= 2) {
        submitDepartures(true);
      }
    }
  }, 1000);
}

function stopTrayTimer() {
  if (trayTimer) {
    clearInterval(trayTimer);
    trayTimer = null;
  }
  trayTimeLeft = 30;
  updateTrayTimerDisplay();
}

function updateTrayTimerDisplay() {
  trayCountdownText.textContent = `${trayTimeLeft}s`;
  const pct = (trayTimeLeft / 30) * 100;
  trayTimerBar.style.width = `${pct}%`;
}

async function submitDepartures(together = true) {
  if (leavingTray.length === 0) return;
  const items = [...leavingTray];
  leavingTray = [];
  renderLeavingTray();

  const session = api.getMonitorSession();
  const token = session?.token;

  // Mark departing bands locally
  for (const item of items) {
    const key = item.shortCode || item.bandToken;
    if (key) localInsideBands.delete(key);
  }

  if (together || items.length === 1) {
    // Single group departure
    const bandTokens = items.map(i => i.bandToken).filter(Boolean);
    const shortCodes = items.map(i => i.shortCode).filter(Boolean);

    const names = items.map(i => i.name).join(' + ');
    const suffix = items.length > 1 ? 'left together' : 'left';
    showFlash(`${names} ${suffix}`, 'amber', 3000);

    const res = await offline.executeOrQueueDeparture({ bandTokens, shortCodes }, token);
    if (!res.queued && res.error) {
      showFlash(res.message || 'Failed to record departures', 'red');
    }
  } else {
    // Each person leaves alone separately
    const names = items.map(i => i.name).join(', ');
    showFlash(`${names} left alone`, 'amber', 3000);

    for (const item of items) {
      const res = await offline.executeOrQueueDeparture({
        bandTokens: item.bandToken ? [item.bandToken] : undefined,
        shortCodes: item.shortCode ? [item.shortCode] : undefined,
      }, token);
      if (!res.queued && res.error) {
        showFlash(res.message || 'Failed to record departure', 'red');
      }
    }
  }
}

btnLeaveAlone.addEventListener('click', () => submitDepartures(false));
btnLeaveTogether.addEventListener('click', () => submitDepartures(true));

// --- Manual 4-Character Code Submission ---

manualCodeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = manualCodeInput.value.trim().toUpperCase();
  if (code.length === 4) {
    manualCodeInput.value = '';
    handleBandScanned({ shortCode: code });
  }
});

manualCodeFormOut.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = manualCodeInputOut.value.trim().toUpperCase();
  if (code.length === 4) {
    manualCodeInputOut.value = '';
    handleBandScanned({ shortCode: code });
  }
});

// --- Camera Scanner Implementation (PDF417 and QR) ---

btnOpenQrScanner.addEventListener('click', () => openCameraScanner('band'));
btnOpenQrScannerOut.addEventListener('click', () => openCameraScanner('band'));

async function openCameraScanner(mode = 'id') {
  cameraMode = mode;
  cameraModal.classList.add('open');
  scannerGuideText.textContent = mode === 'id' ? 'Back of license, barcode in the box' : 'Point camera at band QR';

  const reticle = document.getElementById('scanner-reticle');
  if (reticle) {
    reticle.className = mode === 'id' ? 'scanner-reticle-box reticle-id' : 'scanner-reticle-box reticle-qr';
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    scannerVideo.srcObject = cameraStream;
    scannerVideo.setAttribute('playsinline', 'true');
    await scannerVideo.play();
    cameraActive = true;

    cameraTrack = cameraStream.getVideoTracks()[0];
    const capabilities = cameraTrack.getCapabilities?.() || {};
    if (capabilities.torch) {
      btnTorch.classList.remove('hidden');
    } else {
      btnTorch.classList.add('hidden');
    }

    startBarcodeDetectionLoop();
  } catch (err) {
    closeCameraModal();
    showFlash('Camera permission denied or camera unavailable', 'red');
  }
}

btnTorch.addEventListener('click', async () => {
  if (cameraTrack) {
    try {
      const current = cameraTrack.getSettings()?.torch || false;
      await cameraTrack.applyConstraints({
        advanced: [{ torch: !current }],
      });
    } catch (e) {
      console.warn('Torch toggle failed', e);
    }
  }
});

function closeCameraModal() {
  cameraActive = false;
  cameraModal.classList.remove('open');
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (zxingReader) {
    try {
      zxingReader.reset();
    } catch (e) {
      // Ignore
    }
    zxingReader = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    cameraTrack = null;
  }
  scannerVideo.srcObject = null;
}

btnCloseCamera.addEventListener('click', closeCameraModal);

async function startBarcodeDetectionLoop() {
  const format = cameraMode === 'id' ? 'pdf417' : 'qr_code';
  let nativeDetector = null;

  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (supported.includes(format)) {
        nativeDetector = new window.BarcodeDetector({ formats: [format] });
      }
    } catch (e) {
      // Fallback
    }
  }

  // If native detector not available, initialize ZXing fallback
  if (!nativeDetector && window.ZXing) {
    try {
      if (cameraMode === 'id') {
        zxingReader = new window.ZXing.BrowserPDF417Reader();
      } else {
        zxingReader = new window.ZXing.BrowserQRCodeReader();
      }
    } catch (e) {
      console.warn('ZXing fallback failed to initialize', e);
    }
  }

  let lastZxingAttempt = 0;

  const checkFrame = async () => {
    if (!cameraActive) return;

    if (scannerVideo.readyState >= 2 && scannerVideo.videoWidth > 0) {
      if (nativeDetector) {
        try {
          const codes = await nativeDetector.detect(scannerVideo);
          if (codes && codes.length > 0) {
            const raw = codes[0].rawValue;
            if (cameraMode === 'id') {
              handleIdBarcodeDecoded(raw);
              return;
            } else {
              const parsed = parseScannedValue(raw);
              if (parsed) {
                closeCameraModal();
                handleBandScanned(parsed);
                return;
              }
            }
          }
        } catch (e) {
          // Ignore detection errors per frame
        }
      } else if (zxingReader) {
        const now = performance.now();
        if (now - lastZxingAttempt >= 120) {
          lastZxingAttempt = now;
          try {
            const result = zxingReader.decode(scannerVideo);
            if (result) {
              const raw = result.getText ? result.getText() : result.text;
              if (raw) {
                if (cameraMode === 'id') {
                  handleIdBarcodeDecoded(raw);
                  return;
                } else {
                  const parsed = parseScannedValue(raw);
                  if (parsed) {
                    closeCameraModal();
                    handleBandScanned(parsed);
                    return;
                  }
                }
              }
            }
          } catch (e) {
            // Barcode not found in this frame; continue
          }
        }
      }
    }

    animFrameId = requestAnimationFrame(checkFrame);
  };

  animFrameId = requestAnimationFrame(checkFrame);
}

// --- Guest Search & Walk-in Modal ---

btnOpenGuestSearch.addEventListener('click', () => {
  openGuestSearch('Search Guest List');
});

async function openGuestSearch(title = 'Guest List') {
  guestSearchTitle.textContent = title;
  guestSearchModal.classList.add('open');
  guestSearchInput.value = '';
  await executeGuestSearch('');
}

btnCloseGuestSearch.addEventListener('click', () => {
  guestSearchModal.classList.remove('open');
  unlinkedBand = null;
});

guestSearchInput.addEventListener('input', (e) => {
  executeGuestSearch(e.target.value);
});

async function executeGuestSearch(q) {
  try {
    const guests = await api.searchGuests(q);
    renderGuestSearchResults(guests);
  } catch (err) {
    guestSearchResults.innerHTML = '<p class="text-muted text-center">Failed to load guests</p>';
  }
}

function renderGuestSearchResults(guests) {
  guestSearchResults.innerHTML = '';
  if (!guests || guests.length === 0) {
    guestSearchResults.innerHTML = '<p class="text-muted text-center" style="padding: 1.5rem 0;">No matching guests found</p>';
    return;
  }

  guests.forEach(guest => {
    if (guest.band) {
      localGuestMap.set(guest.band, guest.name);
      if (guest.inside) localInsideBands.add(guest.band);
    }

    const item = document.createElement('div');
    item.className = 'guest-search-item';
    item.innerHTML = `
      <div>
        <span class="guest-item-name">${guest.name}</span>
        ${guest.band ? `<span class="badge badge-muted" style="margin-left: 0.5rem;">[${guest.band}]</span>` : ''}
      </div>
      <span class="badge ${guest.inside ? 'badge-green' : 'badge-muted'}">
        ${guest.inside ? 'Inside' : guest.band ? 'Linked' : 'Tap to Link'}
      </span>
    `;

    item.addEventListener('click', async () => {
      const session = api.getMonitorSession();
      const token = session?.token;

      if (unlinkedBand) {
        // Link this guest to the unlinked band
        const band = unlinkedBand;
        const key = band.shortCode || band.bandToken;
        showFlash(`✓ ${guest.name} in`, 'green');
        guestSearchModal.classList.remove('open');
        unlinkedBand = null;
        if (key) {
          localInsideBands.add(key);
          localGuestMap.set(key, guest.name);
        }

        const res = await offline.executeOrQueueScan({
          bandToken: band.bandToken,
          shortCode: band.shortCode,
          direction: 'in',
          guestId: guest.id,
        }, token);

        if (!res.queued && res.error) {
          showFlash(res.message || 'Failed to link guest', 'red');
        }
      } else {
        // ID check pending link
        if (pendingIdGuest) {
          pendingIdGuest.id = guest.id;
          pendingIdGuest.name = guest.name;
          idGuestName.textContent = guest.name;
          guestSearchModal.classList.remove('open');
        } else {
          showFlash(`Selected: ${guest.name}. Tap band to check in.`, 'amber');
          pendingIdGuest = guest;
          idGuestName.textContent = guest.name;
          idBadgeWrap.innerHTML = '<div class="age-badge badge-21plus">GUEST</div>';
          idResultContainer.classList.remove('hidden');
          guestSearchModal.classList.remove('open');
        }
      }
    });

    guestSearchResults.appendChild(item);
  });
}

// --- Walk-in Guest Creation ---

btnOpenAddWalkin.addEventListener('click', () => {
  guestSearchModal.classList.remove('open');
  walkinModal.classList.add('open');
  walkinName.value = '';
  walkinEmail.value = '';
  walkinPhone.value = '';
});

function closeWalkinModal() {
  walkinModal.classList.remove('open');
}

btnCloseWalkin.addEventListener('click', closeWalkinModal);
btnCancelWalkin.addEventListener('click', closeWalkinModal);

walkinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = api.getMonitorSession();
  if (!session?.eventId) return;

  const name = walkinName.value.trim();
  const email = walkinEmail.value.trim();
  const phone = walkinPhone.value.trim();

  try {
    const res = await api.addWalkInGuest(session.eventId, { name, email, phone });
    closeWalkinModal();

    if (unlinkedBand) {
      const band = unlinkedBand;
      const key = band.shortCode || band.bandToken;
      showFlash(`✓ ${res.guest.name} in`, 'green');
      unlinkedBand = null;
      if (key) {
        localInsideBands.add(key);
        localGuestMap.set(key, res.guest.name);
      }

      const scanRes = await offline.executeOrQueueScan({
        bandToken: band.bandToken,
        shortCode: band.shortCode,
        direction: 'in',
        guestId: res.guest.id,
      }, session.token);

      if (!scanRes.queued && scanRes.error) {
        showFlash(scanRes.message || 'Failed to link walk-in band', 'red');
      }
    } else {
      showFlash(`Created walk-in: ${res.guest.name}. Tap band now.`, 'green');
      pendingIdGuest = res.guest;
      idGuestName.textContent = res.guest.name;
      idBadgeWrap.innerHTML = '<div class="age-badge badge-21plus">WALK-IN</div>';
      idResultContainer.classList.remove('hidden');
    }
  } catch (err) {
    showFlash(err.message || 'Failed to add walk-in guest', 'red');
  }
});

// Initialize on page load
initSession();
