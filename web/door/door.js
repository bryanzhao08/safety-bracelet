// web/door/door.js - Redesigned Door Scanner Controller
import * as api from '../shared/api.js';
import * as offline from './offline.js';
import { parseAamva } from '../shared/aamva.js';
import { parseScannedValue } from '../shared/qr-scanner.js';

// DOM Elements
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
const doorStatusDot = document.getElementById('door-status-dot');
const doorOfflineBadge = document.getElementById('door-offline-badge');

const btnModeIn = document.getElementById('btn-mode-in');
const btnModeOut = document.getElementById('btn-mode-out');
const inModeTop = document.getElementById('in-mode-top');
const outModeTop = document.getElementById('out-mode-top');
const inModeActions = document.getElementById('in-mode-actions');
const outModeActions = document.getElementById('out-mode-actions');

const btnTapZone = document.getElementById('btn-tap-zone');
const tapZoneText = document.getElementById('tap-zone-text');

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
const btnLeaveTogether = document.getElementById('btn-leave-together');
const btnLeaveAlone = document.getElementById('btn-leave-alone');

// Camera Modal Elements
const cameraModal = document.getElementById('camera-modal');
const scannerVideo = document.getElementById('scanner-video');
const scannerReticle = document.getElementById('scanner-reticle');
const scannerGuideText = document.getElementById('scanner-guide-text');
const btnCloseCamera = document.getElementById('btn-close-camera');
const btnTorch = document.getElementById('btn-torch');

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

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .catch(err => console.warn('SW registration failed', err));
}

// Update Tap Zone instructions according to NFC capability
function updateTapZoneInstructions() {
  if (!tapZoneText) return;
  const hasNfc = 'NDEFReader' in window;
  const isAndroid = /android/i.test(navigator.userAgent);
  if (hasNfc && isAndroid) {
    tapZoneText.textContent = 'Hold a band to the phone';
  } else {
    tapZoneText.textContent = "Scan the band's QR or type its code";
  }
}
updateTapZoneInstructions();

// Tap zone button opens camera QR scanner
btnTapZone?.addEventListener('click', () => {
  startCamera('band');
});

// Initialize offline queue & subscribe
offline.initOfflineQueue();
offline.onQueueChange(({ count, isSyncing }) => {
  // Update Header status dot and offline count badge
  if (doorStatusDot && doorOfflineBadge) {
    if (count > 0) {
      doorStatusDot.classList.add('offline');
      doorOfflineBadge.textContent = String(count);
      doorOfflineBadge.classList.remove('hidden');
    } else {
      doorStatusDot.classList.remove('offline');
      doorOfflineBadge.classList.add('hidden');
    }
  }

  // Update offlineBar if visible
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

// --- Orchestrated Verdict Flood (1.2 s) ---
let floodTimer = null;
function triggerVerdictFlood({ name, verdict, detail, type = 'orange' }) {
  const flood = document.getElementById('verdict-flood');
  const floodName = document.getElementById('flood-name');
  const floodBadge = document.getElementById('flood-badge');
  const floodDetail = document.getElementById('flood-detail');
  if (!flood) return;

  floodName.textContent = name || 'GUEST';
  floodBadge.textContent = verdict || '';
  floodDetail.textContent = detail || '';
  flood.className = `verdict-flood flood-${type} active`;

  if (navigator.vibrate) {
    try {
      if (type === 'orange' || type === 'lime') navigator.vibrate(60);
      else if (type === 'pink') navigator.vibrate([60, 40, 60]);
      else navigator.vibrate([100, 50, 100]);
    } catch {}
  }

  clearTimeout(floodTimer);
  floodTimer = setTimeout(() => {
    flood.classList.remove('active');
  }, 1200);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// --- Mode Switch (IN / OUT) ---
function setMode(mode) {
  currentMode = mode;
  doorView.setAttribute('data-mode', mode);

  const isOut = mode === 'out';
  btnModeIn.setAttribute('aria-pressed', (!isOut).toString());
  btnModeOut.setAttribute('aria-pressed', isOut.toString());
  btnModeIn.className = isOut ? 'mode-btn' : 'mode-btn active-in';
  btnModeOut.className = isOut ? 'mode-btn active-out' : 'mode-btn';

  const modeSwitch = btnModeIn.closest('.mode-switch');
  if (modeSwitch) {
    modeSwitch.setAttribute('data-mode', mode);
    if (isOut) modeSwitch.classList.add('mode-out');
    else modeSwitch.classList.remove('mode-out');
  }

  if (btnTapZone) {
    btnTapZone.className = isOut ? 'door-tap-zone glass mode-out' : 'door-tap-zone glass mode-in';
  }

  if (isOut) {
    inModeTop?.classList.add('hidden');
    outModeTop?.classList.remove('hidden');
    inModeActions?.classList.add('hidden');
    outModeActions?.classList.remove('hidden');
    renderLeavingTray();
  } else {
    outModeTop?.classList.add('hidden');
    inModeTop?.classList.remove('hidden');
    outModeActions?.classList.add('hidden');
    inModeActions?.classList.remove('hidden');
  }
}

btnModeIn.addEventListener('click', (e) => {
  e.preventDefault();
  setMode('in');
});

btnModeOut.addEventListener('click', (e) => {
  e.preventDefault();
  setMode('out');
});

// Event delegation on mode switch
document.querySelector('.mode-switch')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (btn) {
    setMode(btn.getAttribute('data-mode'));
  }
});

// --- Shift Join & Session Management ---
let pendingBandToken = null;

async function initSession() {
  const urlParams = new URLSearchParams(window.location.search);
  const prefillToken = urlParams.get('band') || urlParams.get('bandToken') || urlParams.get('b');
  if (prefillToken) {
    pendingBandToken = prefillToken;
  }
  const urlEventId = urlParams.get('event') || urlParams.get('eventId');
  const urlCode = urlParams.get('code') || urlParams.get('monitorCode');

  if (urlEventId && joinEventId) joinEventId.value = urlEventId;
  if (urlCode && joinMonitorCode) joinMonitorCode.value = urlCode;

  let session = api.getMonitorSession();
  if (!session && urlEventId && urlCode) {
    try {
      const res = await api.joinMonitor(urlEventId, { monitorCode: urlCode.toUpperCase(), name: 'Door' });
      session = api.getMonitorSession();
      doorEventName.textContent = res.event?.name || 'Homebound Event';
      doorMonitorName.textContent = 'Monitor: Door';
      joinView.classList.add('hidden');
      doorView.classList.remove('hidden');
      initNfc();
    } catch (e) {
      console.warn('Auto-join failed:', e);
    }
  }

  if (session && session.token && session.eventId) {
    doorEventName.textContent = session.eventName || 'Homebound Event';
    doorMonitorName.textContent = `Monitor: ${session.name || 'Active'}`;
    joinView.classList.add('hidden');
    doorView.classList.remove('hidden');

    initNfc();

    if (pendingBandToken) {
      const token = pendingBandToken;
      pendingBandToken = null;
      handleBandScanned({ bandToken: token });
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('band');
      cleanUrl.searchParams.delete('bandToken');
      cleanUrl.searchParams.delete('b');
      window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));
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

    if (pendingBandToken) {
      const token = pendingBandToken;
      pendingBandToken = null;
      handleBandScanned({ bandToken: token });
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('band');
      cleanUrl.searchParams.delete('bandToken');
      cleanUrl.searchParams.delete('b');
      window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));
    }
  } catch (err) {
    joinError.textContent = err.message || 'Failed to join shift. Check Event ID and Monitor Code.';
    joinError.classList.remove('hidden');
  }
});

btnLeaveShift.addEventListener('click', () => {
  if (confirm('Leave door shift? You can re-enter with the Monitor Code.')) {
    api.clearMonitorSession();
    window.location.reload();
  }
});

// --- Web NFC Integration ---
async function initNfc() {
  if (!('NDEFReader' in window)) {
    updateTapZoneInstructions();
    return;
  }

  try {
    const ndef = new window.NDEFReader();
    await ndef.scan();
    updateTapZoneInstructions();

    ndef.addEventListener('reading', ({ message }) => {
      for (const record of message.records) {
        if (record.recordType === 'url') {
          const textDecoder = new TextDecoder();
          const urlString = textDecoder.decode(record.data);
          const parsed = parseScannedValue(urlString);
          if (parsed) {
            handleBandScanned(parsed);
            return;
          }
        } else if (record.recordType === 'text') {
          const textDecoder = new TextDecoder();
          const text = textDecoder.decode(record.data);
          const parsed = parseScannedValue(text);
          if (parsed) {
            handleBandScanned(parsed);
            return;
          }
        }
      }
    });

    ndef.addEventListener('readingerror', () => {
      triggerVerdictFlood({ name: 'NFC Error', verdict: 'RETRY', detail: 'Hold wristband steady to phone', type: 'stop' });
    });
  } catch (err) {
    updateTapZoneInstructions();
  }
}

// --- Universal Band Scan Handler ---
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

  // Case A: ID was scanned first, guest pending link
  if (pendingIdGuest) {
    if (!pendingIdGuest.id) {
      triggerVerdictFlood({ name: 'Select Guest', verdict: 'CHOOSE', detail: 'Pick a matching guest from list', type: 'stop' });
      return;
    }
    const guest = pendingIdGuest;
    triggerVerdictFlood({ name: guest.name, verdict: 'IN', detail: 'Checked in & band linked', type: 'orange' });
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
        triggerVerdictFlood({ name: 'Already Linked', verdict: 'ERROR', detail: 'Band already linked to another guest', type: 'stop' });
      } else {
        triggerVerdictFlood({ name: 'Error', verdict: 'FAILED', detail: res.message || 'Failed to link band', type: 'stop' });
      }
    }
    return;
  }

  // Case B: Direct band scan
  const knownName = localGuestMap.get(key);
  const alreadyInsideLocally = key && localInsideBands.has(key);

  if (alreadyInsideLocally) {
    triggerVerdictFlood({ name: knownName || key, verdict: 'ALREADY IN', detail: 'Already checked in', type: 'stop' });
  } else {
    triggerVerdictFlood({ name: knownName || key || 'Guest', verdict: 'IN', detail: 'Checked in', type: 'orange' });
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
    if (key) localInsideBands.delete(key);
    unlinkedBand = { bandToken, shortCode: res.data.band?.shortCode || shortCode };
    const codeStr = unlinkedBand.shortCode ? ` ${unlinkedBand.shortCode}` : '';
    openGuestSearch(`Link band${codeStr}`);
    return;
  }

  if (res.data?.warning === 'already_inside') {
    if (key) localInsideBands.add(key);
    triggerVerdictFlood({ name: res.data.guest?.name || 'Guest', verdict: 'ALREADY IN', detail: 'Already checked in', type: 'stop' });
    return;
  }

  if (res.error) {
    if (key && !alreadyInsideLocally) localInsideBands.delete(key);
    if (res.status === 409 && res.error === 'band_already_linked') {
      triggerVerdictFlood({ name: 'Already Linked', verdict: 'ERROR', detail: 'Band already linked to another guest', type: 'stop' });
    } else {
      triggerVerdictFlood({ name: 'Scan Error', verdict: 'FAILED', detail: res.message || 'Failed to scan band', type: 'stop' });
    }
    return;
  }

  if (res.data?.guest) {
    if (key) {
      localInsideBands.add(key);
      localGuestMap.set(key, res.data.guest.name);
    }
    triggerVerdictFlood({ name: res.data.guest.name, verdict: 'IN', detail: 'Checked in', type: 'orange' });
  }
}

// Manual Short Code check-in
manualCodeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = manualCodeInput.value.trim().toUpperCase();
  if (!code) return;
  manualCodeInput.value = '';
  await handleCheckInBand({ shortCode: code });
});

// --- ID Check-in Flow ---
btnOpenIdScanner.addEventListener('click', () => {
  startCamera('id');
});

function calculateAge(dobStr) {
  if (!dobStr) return null;
  const match = dobStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const birthYear = parseInt(match[1], 10);
  const birthMonth = parseInt(match[2], 10) - 1;
  const birthDay = parseInt(match[3], 10);
  const birthDate = new Date(birthYear, birthMonth, birthDay);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

async function handleIdBarcodeDecoded(barcodeText) {
  closeCameraModal();
  const parsed = parseAamva(barcodeText);
  if (!parsed || (!parsed.lastName && !parsed.firstName)) {
    triggerVerdictFlood({ name: 'Invalid ID', verdict: 'RETRY', detail: 'Could not parse license barcode', type: 'stop' });
    return;
  }

  try {
    const res = await api.idCheckin({
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      dob: parsed.dob,
      idState: parsed.idState,
      idExpires: parsed.idExpires,
      licenseNumber: parsed.licenseNumber,
    });
    renderIdResult(parsed, res);
  } catch (err) {
    triggerVerdictFlood({ name: 'ID Check Failed', verdict: 'ERROR', detail: err.message, type: 'stop' });
  }
}

function renderIdResult(parsed, res) {
  idResultContainer.classList.remove('hidden');

  const displayName = res.guest?.name || [parsed.firstName, parsed.lastName].filter(Boolean).join(' ') || 'Guest';
  idGuestName.textContent = displayName;

  const age = calculateAge(parsed.dob);
  const metaParts = [];
  if (age !== null) metaParts.push(`Age: ${age}`);
  if (parsed.dob) metaParts.push(`DOB: ${parsed.dob}`);
  if (parsed.idState) metaParts.push(`State: ${parsed.idState}`);
  idMetaLine.textContent = metaParts.join(' · ');

  idBadgeWrap.innerHTML = '';
  const badge = document.createElement('div');

  if (res.expired) {
    badge.className = 'id-age-band band-stop';
    badge.innerHTML = `<span>EXPIRED</span><span style="font-size: var(--text-16); font-family: var(--font-sans); font-weight: 600;">ID Expired</span>`;
    triggerVerdictFlood({ name: displayName, verdict: 'EXPIRED', detail: 'ID Expired', type: 'stop' });
  } else if (res.over21) {
    badge.className = 'id-age-band band-lime';
    badge.innerHTML = `<span>21+</span><span style="font-size: var(--text-16); font-family: var(--font-sans); font-weight: 600;">${age ? 'Age ' + age : 'Verified'}</span>`;
    triggerVerdictFlood({ name: displayName, verdict: '21+', detail: age ? `Age ${age}` : 'Verified', type: 'lime' });
  } else {
    badge.className = 'id-age-band band-stop';
    badge.innerHTML = `<span>UNDER 21</span><span style="font-size: var(--text-16); font-family: var(--font-sans); font-weight: 600;">${age ? 'Age ' + age : 'Under 21'}</span>`;
    triggerVerdictFlood({ name: displayName, verdict: 'UNDER 21', detail: age ? `Age ${age}` : 'Under 21', type: 'stop' });
  }
  idBadgeWrap.appendChild(badge);

  if (res.duplicate) {
    const timeStr = res.duplicate.at ? ` at ${api.formatTime(res.duplicate.at)}` : '';
    idDuplicateWarning.textContent = `Duplicate: ID already scanned tonight${timeStr}`;
    idDuplicateWarning.classList.remove('hidden');
  } else {
    idDuplicateWarning.classList.add('hidden');
  }

  if (res.candidates && res.candidates.length > 0) {
    pendingIdGuest = null;
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
        triggerVerdictFlood({ name: cand.name, verdict: 'SELECTED', detail: 'Tap wristband now', type: 'orange' });
      });
      idCandidatesList.appendChild(btn);
    });

    const walkinBtn = document.createElement('button');
    walkinBtn.type = 'button';
    walkinBtn.className = 'btn btn-secondary';
    walkinBtn.textContent = `+ Add walk-in ("${displayName}")`;
    walkinBtn.addEventListener('click', async () => {
      const session = api.getMonitorSession();
      if (!session?.eventId) return;
      try {
        const added = await api.addWalkInGuest(session.eventId, { name: displayName });
        pendingIdGuest = added.guest;
        idGuestName.textContent = added.guest.name;
        idCandidatesContainer.classList.add('hidden');
        triggerVerdictFlood({ name: added.guest.name, verdict: 'WALK-IN', detail: 'Tap wristband now', type: 'orange' });
      } catch (err) {
        triggerVerdictFlood({ name: 'Error', verdict: 'FAILED', detail: err.message, type: 'stop' });
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
    triggerVerdictFlood({ name: existing.name || 'Guest', verdict: 'IN TRAY', detail: 'Already added to tray', type: 'pink' });
    return;
  }

  const key = shortCode || bandToken;
  let guestName = localGuestMap.get(key) || (shortCode ? `Band [${shortCode}]` : 'Guest');

  if (!localGuestMap.has(key)) {
    try {
      const results = await api.searchGuests(shortCode || '');
      const match = results?.find(g => g.band === shortCode);
      if (match) {
        guestName = match.name;
        localGuestMap.set(key, match.name);
      }
    } catch {}
  }

  leavingTray.push({ bandToken, shortCode, name: guestName });
  renderLeavingTray();
  resetTrayTimer();

  triggerVerdictFlood({
    name: guestName,
    verdict: 'OUT TRAY',
    detail: `${leavingTray.length} in leaving group`,
    type: 'pink'
  });
}

function renderLeavingTray() {
  leavingGuestList.innerHTML = '';
  trayCount.textContent = String(leavingTray.length);

  if (leavingTray.length === 0) {
    trayEmptyMsg.classList.remove('hidden');
    leavingGuestList.appendChild(trayEmptyMsg);
    btnLeaveTogether.disabled = true;
    btnLeaveAlone.disabled = true;
    btnLeaveTogether.textContent = 'Done, 0 leaving together';
    stopTrayTimer();
    return;
  }

  trayEmptyMsg.classList.add('hidden');
  btnLeaveTogether.disabled = false;
  btnLeaveAlone.disabled = false;

  if (leavingTray.length === 1) {
    btnLeaveTogether.textContent = 'Done, 1 leaving together';
  } else {
    btnLeaveTogether.textContent = `Done, ${leavingTray.length} leaving together`;
  }

  leavingTray.forEach((item, index) => {
    const chip = document.createElement('div');
    chip.className = 'wristband-chip band-pink';
    chip.style.cursor = 'pointer';
    chip.title = 'Click to remove';
    chip.innerHTML = `
      <span>${escapeHtml(item.name || item.shortCode || 'Guest')}</span>
      ${item.shortCode ? `<span style="opacity: 0.7; font-size: 12px;">(${escapeHtml(item.shortCode)})</span>` : ''}
      <button class="btn-remove-chip" style="background: none; border: none; color: inherit; cursor: pointer; padding: 0 0 0 4px; font-weight: bold;" type="button" aria-label="Remove">&times;</button>
    `;
    chip.querySelector('.btn-remove-chip').addEventListener('click', (e) => {
      e.stopPropagation();
      leavingTray.splice(index, 1);
      renderLeavingTray();
      if (leavingTray.length > 0) resetTrayTimer();
    });
    leavingGuestList.appendChild(chip);
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
      submitDepartures(leavingTray.length > 1);
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

// Submit together as one group
async function submitDepartures(together = true) {
  if (leavingTray.length === 0) return;
  const items = [...leavingTray];
  leavingTray = [];
  renderLeavingTray();

  const session = api.getMonitorSession();
  const token = session?.token;

  for (const item of items) {
    const key = item.shortCode || item.bandToken;
    if (key) localInsideBands.delete(key);
  }

  const bandTokens = items.map(i => i.bandToken).filter(Boolean);
  const shortCodes = items.map(i => i.shortCode).filter(Boolean);
  const names = items.map(i => i.name).join(', ');

  const verdict = together && items.length > 1 ? 'LEFT TOGETHER' : 'LEFT';
  const detail = items.length > 1 ? `${items.length} leaving together` : 'Left alone';
  triggerVerdictFlood({ name: names, verdict, detail, type: 'pink' });

  const res = await offline.executeOrQueueDeparture({ bandTokens, shortCodes }, token);
  if (!res.queued && res.error) {
    triggerVerdictFlood({ name: 'Error', verdict: 'FAILED', detail: res.message || 'Failed to record departures', type: 'stop' });
  }
}

// Submit each individually as "leaving alone"
async function submitDeparturesAlone() {
  if (leavingTray.length === 0) return;
  const items = [...leavingTray];
  leavingTray = [];
  renderLeavingTray();

  const session = api.getMonitorSession();
  const token = session?.token;

  for (const item of items) {
    const key = item.shortCode || item.bandToken;
    if (key) localInsideBands.delete(key);
  }

  const names = items.map(i => i.name).join(', ');
  triggerVerdictFlood({ name: names, verdict: 'LEFT', detail: 'Leaving alone', type: 'pink' });

  for (const item of items) {
    await offline.executeOrQueueDeparture({
      bandTokens: item.bandToken ? [item.bandToken] : [],
      shortCodes: item.shortCode ? [item.shortCode] : [],
    }, token);
  }
}

btnLeaveTogether.addEventListener('click', () => {
  submitDepartures(true);
});

btnLeaveAlone.addEventListener('click', () => {
  submitDeparturesAlone();
});

manualCodeFormOut.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = manualCodeInputOut.value.trim().toUpperCase();
  if (!code) return;
  manualCodeInputOut.value = '';
  await handleDepartureBand({ shortCode: code });
});

// --- Camera QR / Barcode Scanner ---
btnOpenIdScanner.addEventListener('click', () => {
  startCamera('id');
});

btnCloseCamera.addEventListener('click', closeCameraModal);

async function startCamera(mode = 'id') {
  cameraMode = mode;
  scannerGuideText.textContent = mode === 'id' ? 'Point camera at license barcode' : 'Point camera at wristband QR';
  scannerReticle.style.width = mode === 'id' ? '82%' : '65%';
  scannerReticle.style.height = mode === 'id' ? '46%' : '65%';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });

    cameraStream = stream;
    cameraTrack = stream.getVideoTracks()[0];
    scannerVideo.srcObject = stream;
    await scannerVideo.play();

    cameraModal.classList.add('open');
    cameraActive = true;

    if (cameraTrack && typeof cameraTrack.getCapabilities === 'function') {
      const caps = cameraTrack.getCapabilities();
      if (caps.torch) btnTorch.classList.remove('hidden');
    }

    startFrameDetection();
  } catch (err) {
    triggerVerdictFlood({ name: 'Camera Error', verdict: 'DENIED', detail: 'Camera permission denied or unavailable', type: 'stop' });
  }
}

btnTorch.addEventListener('click', async () => {
  if (!cameraTrack) return;
  try {
    const current = cameraTrack.getSettings().torch || false;
    await cameraTrack.applyConstraints({ advanced: [{ torch: !current }] });
  } catch {}
});

function closeCameraModal() {
  cameraActive = false;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraTrack = null;
  }
  cameraModal.classList.remove('open');
  btnTorch.classList.add('hidden');
}

function startFrameDetection() {
  const hasNativeBarcode = 'BarcodeDetector' in window;
  let nativeDetector = null;

  if (hasNativeBarcode) {
    try {
      const formats = cameraMode === 'id' ? ['pdf417'] : ['qr_code'];
      nativeDetector = new window.BarcodeDetector({ formats });
    } catch {
      nativeDetector = null;
    }
  }

  if (!nativeDetector && typeof ZXing !== 'undefined') {
    if (cameraMode === 'id') {
      zxingReader = new ZXing.BrowserPDF417Reader();
    } else {
      zxingReader = new ZXing.BrowserQRCodeReader();
    }
  }

  let lastZxingAttempt = 0;

  const checkFrame = async () => {
    if (!cameraActive) return;

    if (scannerVideo.readyState === scannerVideo.HAVE_ENOUGH_DATA) {
      if (nativeDetector) {
        try {
          const barcodes = await nativeDetector.detect(scannerVideo);
          if (barcodes && barcodes.length > 0) {
            const raw = barcodes[0].rawValue;
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
        } catch {}
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
          } catch {}
        }
      }
    }

    animFrameId = requestAnimationFrame(checkFrame);
  };

  animFrameId = requestAnimationFrame(checkFrame);
}

// --- Guest Search & Link-Band Sheet ---
btnOpenGuestSearch.addEventListener('click', () => {
  openGuestSearch('Guest list');
});

async function openGuestSearch(title = 'Guest list') {
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
  } catch {
    guestSearchResults.innerHTML = '<p class="text-muted text-center" style="padding: 1.5rem 0;">Failed to load guests</p>';
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

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'guest-row-glass';
    row.innerHTML = `
      <div class="guest-row-info">
        <span class="guest-row-name">${escapeHtml(guest.name)}</span>
        ${guest.band ? `<span class="badge badge-muted" style="font-size: 11px;">[${escapeHtml(guest.band)}]</span>` : ''}
        ${guest.inside ? `<span class="badge badge-orange" style="font-size: 11px;">Inside</span>` : ''}
      </div>
      <span class="guest-row-chevron" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </span>
    `;

    row.addEventListener('click', async () => {
      const session = api.getMonitorSession();
      const token = session?.token;

      if (unlinkedBand) {
        const band = unlinkedBand;
        const key = band.shortCode || band.bandToken;
        triggerVerdictFlood({ name: guest.name, verdict: 'IN', detail: 'Band linked', type: 'orange' });
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
          triggerVerdictFlood({ name: 'Error', verdict: 'FAILED', detail: res.message || 'Failed to link guest', type: 'stop' });
        }
      } else {
        if (pendingIdGuest) {
          pendingIdGuest.id = guest.id;
          pendingIdGuest.name = guest.name;
          idGuestName.textContent = guest.name;
          guestSearchModal.classList.remove('open');
        } else {
          pendingIdGuest = guest;
          idGuestName.textContent = guest.name;
          idBadgeWrap.innerHTML = '<div class="id-age-band band-lime"><span>GUEST</span></div>';
          idResultContainer.classList.remove('hidden');
          guestSearchModal.classList.remove('open');
          triggerVerdictFlood({ name: guest.name, verdict: 'SELECTED', detail: 'Tap band to check in', type: 'orange' });
        }
      }
    });

    guestSearchResults.appendChild(row);
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
      triggerVerdictFlood({ name: res.guest.name, verdict: 'IN', detail: 'Walk-in linked', type: 'orange' });
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
        triggerVerdictFlood({ name: 'Error', verdict: 'FAILED', detail: scanRes.message || 'Failed to link walk-in', type: 'stop' });
      }
    } else {
      pendingIdGuest = res.guest;
      idGuestName.textContent = res.guest.name;
      idBadgeWrap.innerHTML = '<div class="id-age-band band-lime"><span>WALK-IN</span></div>';
      idResultContainer.classList.remove('hidden');
      triggerVerdictFlood({ name: res.guest.name, verdict: 'WALK-IN', detail: 'Tap wristband now', type: 'orange' });
    }
  } catch (err) {
    triggerVerdictFlood({ name: 'Error', verdict: 'FAILED', detail: err.message || 'Failed to add walk-in', type: 'stop' });
  }
});

// Initialize on page load
initSession();
