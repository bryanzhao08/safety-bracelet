// web/app/app.js - Homebound PWA Client Application v2

import { newId, encodeCard, decodeCard, cardUrl, parseScan, vcard, PLATFORMS, parseProfileLink, profileUrl, shareableCard } from './lib/card.js';
import { createVault, seal, unlock, open, changePasscode, isLegacyPasscode } from './lib/vault.js';
import { encodeParty, decodeParty, partyUrl } from './lib/party.js';
import { createStore } from './lib/store.js';
import { groupByNight, recap, shareText, formatTime, formatNightLabel } from './lib/nights.js';
import { generateQRSvg } from '../shared/qr.js';
import { QrCameraScanner } from './ui/scanner.js';
import { mountKeypad, askPasscode, createPasscode } from './ui/keypad.js';
import { drawThread } from './ui/thread.js';

// Initialize Store with localStorage
const store = createStore(localStorage);

// State
let currentTab = 'swap';
let me = store.getMe();
let vaultMeta = store.getVault();
let unlockedKey = null; // Stored in memory only!
let autoLockTimer = null;
let nightPad = null;
let animateThreadNext = false;
const threadCleanups = [];
let activeScanner = null;
let selectedContact = null;
let confirmFlipTimer = null;
let lastUnlockedPasscode = '';

// ============================================================================
// Service Worker & PWA Setup
// ============================================================================
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

// iOS Add to Home Screen Prompt
function setupIosPrompt() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const dismissed = localStorage.getItem('hb_pwa_hint_dismissed');

  const banner = document.getElementById('ios-pwa-banner');
  if (isIos && !isStandalone && !dismissed && banner) {
    banner.style.display = 'flex';
    document.getElementById('btn-ios-pwa-close')?.addEventListener('click', () => {
      banner.style.display = 'none';
      localStorage.setItem('hb_pwa_hint_dismissed', '1');
    });
  }
}

// Toast notification helper
function showToast(text, duration = 3000) {
  const toast = document.getElementById('toast-msg');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('is-visible');
  setTimeout(() => {
    toast.classList.remove('is-visible');
  }, duration);
}

// Low accuracy location helper with 4s timeout
async function getQuickLocation() {
  const settings = store.getSettings();
  if (!settings.location || !navigator.geolocation) {
    return undefined;
  }
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve(undefined);
      }
    }, 4000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve({
            lat: Math.round(pos.coords.latitude * 10000) / 10000,
            lng: Math.round(pos.coords.longitude * 10000) / 10000,
            acc: Math.round(pos.coords.accuracy || 0)
          });
        }
      },
      () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve(undefined);
        }
      },
      { enableHighAccuracy: false, timeout: 4000 }
    );
  });
}

// ============================================================================
// Platform Glyphs (Monochrome SVGs)
// ============================================================================
function getPlatformSvg(key) {
  switch (key) {
    case 'ig':
      return `<svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`;
    case 'sc':
      return `<svg viewBox="0 0 24 24"><path d="M12.002 2c-4.05 0-6.406 2.875-6.406 5.813 0 1.348.514 2.593 1.157 3.447.168.223.189.378.083.562-.15.263-.483.479-.906.671-.476.216-1.127.394-1.834.787-.27.15-.436.425-.371.745.097.48.583.743 1.077.801.787.093 1.55-.17 2.218-.009.284.068.423.235.485.492.204.845-.589 1.365-1.171 1.758-.58.391-1.282.866-1.07 1.637.198.718 1.082.973 1.942.85 1.076-.153 2.158-.707 3.25-.494.619.121 1.154.671 1.546 1.445.426-.774.962-1.324 1.581-1.445 1.092-.213 2.174.341 3.25.494.86.123 1.744-.132 1.942-.85.212-.771-.49-1.246-1.07-1.637-.582-.393-1.375-.913-1.171-1.758.062-.257.201-.424.485-.492.668-.161 1.431.102 2.218.009.494-.058.98-.321 1.077-.801.065-.32-.101-.595-.371-.745-.707-.393-1.358-.571-1.834-.787-.423-.192-.756-.408-.906-.671-.106-.184-.085-.339.083-.562.643-.854 1.157-2.099 1.157-3.447 0-2.938-2.356-5.813-6.406-5.813z"/></svg>`;
    case 'tt':
      return `<svg viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.29 0 .58.04.86.12V9.4a6.33 6.33 0 0 0-.86-.06A6.34 6.34 0 0 0 3.14 15.7a6.34 6.34 0 0 0 10.82 4.48 6.3 6.3 0 0 0 1.86-4.48V8.7a8.28 8.28 0 0 0 4.88 1.58V6.84a4.86 4.86 0 0 1-1.11-.15z"/></svg>`;
    case 'x':
      return `<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
    case 'li':
      return `<svg viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>`;
    case 'phone':
    case 'call':
      return `<svg viewBox="0 0 24 24"><path d="M6.62 10.79a15.053 15.053 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20a1 1 0 0 1-1 1c-9.39 0-17-7.61-17-17a1 1 0 0 1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>`;
    case 'sms':
    case 'text':
      return `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
    case 'vcard':
      return `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm6 12H6v-1c0-2 4-3.1 6-3.1s6 1.1 6 3.1v1z"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`;
  }
}

// Helper: Build a social capsule button
function createSocialCapsule(platformKey, handle, customLabel) {
  const a = document.createElement('a');
  a.className = 'social-capsule';
  try {
    a.href = profileUrl(platformKey, handle);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  } catch {
    a.href = '#';
  }
  a.innerHTML = `${getPlatformSvg(platformKey)}<span>${customLabel || handle}</span>`;
  return a;
}

// Helper: Download vCard
function downloadContactVCard(card) {
  try {
    const vcf = vcard(card);
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(card.n || 'contact').toLowerCase().replace(/\s+/g, '_')}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Contact card downloaded');
  } catch (e) {
    console.error('vCard download failed:', e);
  }
}

// ============================================================================
// Device Tilt Rim Light on The Pass
// ============================================================================
function setupPassTilt() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ permission can be requested on first tap
    document.getElementById('pass-flipper')?.addEventListener('click', async () => {
      try {
        const state = await window.DeviceOrientationEvent.requestPermission();
        if (state === 'granted') {
          attachTiltListener();
        }
      } catch {}
    }, { once: true });
  } else if ('ondeviceorientation' in window) {
    attachTiltListener();
  }

  function attachTiltListener() {
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma === null || e.beta === null) return;
      const x = Math.min(Math.max(50 + (e.gamma || 0) * 1.5, 10), 90);
      const y = Math.min(Math.max(25 + (e.beta || 0) * 1.2, 5), 85);
      document.documentElement.style.setProperty('--tilt-x', `${x}%`);
      document.documentElement.style.setProperty('--tilt-y', `${y}%`);
    });
  }
}

// ============================================================================
// Navigation & Views
// ============================================================================
function switchTab(tabName) {
  currentTab = tabName;

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === tabName);
  });

  const swapEl = document.getElementById('view-swap');
  const peopleEl = document.getElementById('view-people');
  const nightEl = document.getElementById('view-night');

  if (swapEl) swapEl.style.display = tabName === 'swap' ? 'flex' : 'none';
  if (peopleEl) peopleEl.style.display = tabName === 'people' ? 'flex' : 'none';
  if (nightEl) nightEl.style.display = tabName === 'night' ? 'flex' : 'none';

  if (tabName === 'swap') {
    renderSwap();
  } else if (tabName === 'people') {
    renderPeople();
  } else if (tabName === 'night') {
    renderNight();
  }
}

// ============================================================================
// Auto-lock & Security
// ============================================================================
function resetAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
  if (!unlockedKey) return;

  const settings = store.getSettings();
  const minutes = settings.autoLockMin || 5;
  autoLockTimer = setTimeout(() => {
    lockNightLog();
    if (currentTab === 'night') {
      renderNight();
    }
    showToast('Night log locked');
  }, minutes * 60 * 1000);
}

function lockNightLog() {
  unlockedKey = null;
  lastUnlockedPasscode = '';
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
  nightPad?.reset();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && unlockedKey) {
    lockNightLog();
    if (currentTab === 'night') {
      renderNight();
    }
  }
});

// ============================================================================
// Swap Screen, Pass & Party Banners
// ============================================================================
function renderSwap() {
  me = store.getMe();
  if (!me) return;

  // Joined party banner
  const partyBanner = document.getElementById('party-joined-banner');
  const bannerTitle = document.getElementById('party-banner-title');
  const party = store.getParty();

  if (partyBanner) {
    if (party) {
      partyBanner.style.display = 'flex';
      if (bannerTitle) bannerTitle.textContent = party.name;
    } else {
      partyBanner.style.display = 'none';
    }
  }

  // Dawn Home Reminder
  const homeReminder = document.getElementById('party-home-reminder');
  if (homeReminder) {
    homeReminder.style.display = store.homeReminderDue() ? 'flex' : 'none';
  }

  // Populate Pass front
  const nameEl = document.getElementById('stub-name');
  const handlesEl = document.getElementById('stub-handles');
  const qrContainer = document.getElementById('stub-qr-container');

  if (nameEl) nameEl.textContent = me.n || 'Your Name';

  if (handlesEl) {
    handlesEl.innerHTML = '';
    const share = store.getShare();
    const parts = [];
    if (me.p && share.p !== false) parts.push(me.p);
    for (const p of PLATFORMS) {
      if (me[p.key] && share[p.key] !== false) {
        parts.push(`${p.key} ${me[p.key]}`);
      }
    }
    handlesEl.textContent = parts.join(' · ') || '';
  }

  // Generate QR SVG with shareableCard
  if (qrContainer) {
    const appUrl = window.location.href.split('#')[0];
    const share = store.getShare();
    const shareable = shareableCard(me, share);
    const encodedUrl = cardUrl(appUrl, shareable);
    try {
      const svgMarkup = generateQRSvg(encodedUrl, {
        size: 220,
        margin: 1,
        color: '#000000',
        bgColor: '#FFFFFF'
      });
      qrContainer.innerHTML = svgMarkup;
    } catch (e) {
      console.warn('QR generation failed:', e);
    }
  }

  // Update Face to face mini pass
  const miniName = document.getElementById('face-mini-name');
  const miniQr = document.getElementById('face-mini-qr');
  if (miniName) miniName.textContent = me.n || '';
  if (miniQr && qrContainer) {
    miniQr.innerHTML = qrContainer.innerHTML;
  }
}

// Flip Confirmation Motion on The Pass
function showScanConfirmation(person, isNew) {
  const flipper = document.getElementById('pass-flipper');
  const heading = document.getElementById('confirm-heading');
  const subhead = document.getElementById('confirm-subhead');
  const socialsGrid = document.getElementById('confirm-socials-grid');
  const doneBtn = document.getElementById('btn-confirm-done');

  if (!flipper) return;

  const displayName = person.n || 'Friend';
  if (heading) {
    heading.textContent = isNew ? `Added ${displayName}` : `Still with ${displayName}`;
  }
  if (subhead) {
    subhead.textContent = 'Saved to your night';
  }

  // Build social capsule buttons
  if (socialsGrid) {
    socialsGrid.innerHTML = '';
    // Call & Text if phone exists
    if (person.p) {
      const callBtn = document.createElement('a');
      callBtn.className = 'social-capsule';
      callBtn.href = `tel:${person.p}`;
      callBtn.innerHTML = `${getPlatformSvg('call')}<span>Call</span>`;
      socialsGrid.appendChild(callBtn);

      const textBtn = document.createElement('a');
      textBtn.className = 'social-capsule';
      textBtn.href = `sms:${person.p}`;
      textBtn.innerHTML = `${getPlatformSvg('sms')}<span>Text</span>`;
      socialsGrid.appendChild(textBtn);
    }

    // Platforms
    for (const plat of PLATFORMS) {
      if (person[plat.key]) {
        socialsGrid.appendChild(createSocialCapsule(plat.key, person[plat.key]));
      }
    }

    // Save vCard button
    const vcardBtn = document.createElement('button');
    vcardBtn.type = 'button';
    vcardBtn.className = 'social-capsule';
    vcardBtn.innerHTML = `${getPlatformSvg('vcard')}<span>Save contact</span>`;
    vcardBtn.onclick = () => downloadContactVCard(person);
    socialsGrid.appendChild(vcardBtn);
  }

  // Switch to Swap view if not already there
  switchTab('swap');

  // Trigger 3D flip motion
  flipper.classList.add('is-flipped');

  function flipBack() {
    if (confirmFlipTimer) {
      clearTimeout(confirmFlipTimer);
      confirmFlipTimer = null;
    }
    flipper.classList.remove('is-flipped');
  }

  if (doneBtn) doneBtn.onclick = flipBack;

  // Auto flip back after 6 seconds
  if (confirmFlipTimer) clearTimeout(confirmFlipTimer);
  confirmFlipTimer = setTimeout(flipBack, 6000);
}

// Quick Actions Menu & Note Logging
function setupQuickActions() {
  // Add note button
  document.getElementById('quick-btn-note')?.addEventListener('click', () => {
    openNoteModal();
  });

  // I'm home button
  document.getElementById('quick-btn-home')?.addEventListener('click', async () => {
    await recordHomeAction();
  });

  // Dawn reminder "I'm home" button
  document.getElementById('btn-banner-record-home')?.addEventListener('click', async () => {
    await recordHomeAction();
  });
}

async function recordHomeAction() {
  vaultMeta = store.getVault();
  if (!vaultMeta) {
    showToast('Vault not initialized');
    return;
  }
  try {
    const loc = await getQuickLocation();
    await store.recordHome({ now: new Date().toISOString(), loc });
    showToast('Saved to your night');
    renderSwap();
  } catch (err) {
    console.error('Failed to log home:', err);
    showToast('Failed to save home entry');
  }
}

function openNoteModal() {
  const overlay = document.getElementById('modal-note');
  const textarea = document.getElementById('note-text');
  const charCount = document.getElementById('note-char-count');
  if (!overlay || !textarea) return;

  textarea.value = '';
  if (charCount) charCount.textContent = '0 / 280';
  overlay.classList.add('is-open', 'open');
  textarea.focus();
}

function closeNoteModal() {
  document.getElementById('modal-note')?.classList.remove('is-open', 'open');
}

function setupNoteModal() {
  const form = document.getElementById('form-note');
  const textarea = document.getElementById('note-text');
  const charCount = document.getElementById('note-char-count');
  const closeBtn = document.getElementById('btn-close-note');

  closeBtn?.addEventListener('click', closeNoteModal);
  document.getElementById('modal-note')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeNoteModal();
  });

  textarea?.addEventListener('input', () => {
    if (charCount) {
      charCount.textContent = `${textarea.value.length} / 280`;
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea?.value.trim();
    if (!text) return;

    try {
      const loc = await getQuickLocation();
      await store.recordNote({ text, now: new Date().toISOString(), loc });
      closeNoteModal();
      showToast('Saved to your night');
    } catch (err) {
      console.error('Failed to seal note:', err);
      showToast('Failed to save note');
    }
  });
}

// ============================================================================
// Camera QR Scanners & Manual Code Fallback
// ============================================================================
function setupScanners() {
  const btnScanTheirs = document.getElementById('btn-scan-theirs');
  const btnFaceToFace = document.getElementById('btn-face-to-face');

  const theirsModal = document.getElementById('scanner-theirs-modal');
  const theirsVideo = document.getElementById('scanner-theirs-video');
  const theirsClose = document.getElementById('btn-close-scan-theirs');

  const faceModal = document.getElementById('scanner-face-modal');
  const faceVideo = document.getElementById('scanner-face-video');
  const faceClose = document.getElementById('btn-close-scan-face');

  function stopScanner() {
    if (activeScanner) {
      activeScanner.stop();
      activeScanner = null;
    }
    theirsModal?.classList.remove('is-open');
    faceModal?.classList.remove('is-open');
  }

  theirsClose?.addEventListener('click', stopScanner);
  faceClose?.addEventListener('click', stopScanner);

  // Manual fallback buttons inside scanners
  document.getElementById('btn-theirs-manual-fallback')?.addEventListener('click', () => {
    stopScanner();
    openManualPasteModal();
  });
  document.getElementById('btn-face-manual-fallback')?.addEventListener('click', () => {
    stopScanner();
    openManualPasteModal();
  });

  // Scan theirs (Back Camera)
  btnScanTheirs?.addEventListener('click', async () => {
    stopScanner();
    theirsModal?.classList.add('is-open');

    activeScanner = new QrCameraScanner(theirsVideo, {
      facingMode: 'environment',
      onScan: (text) => processScannedText(text, stopScanner),
      onError: (err) => {
        console.warn('Scanner error:', err);
        showToast('Camera access denied or unavailable');
        stopScanner();
        openManualPasteModal();
      }
    });

    try {
      await activeScanner.start('environment');
    } catch {
      stopScanner();
      openManualPasteModal();
    }
  });

  // Face to face (Front Camera + Your QR)
  btnFaceToFace?.addEventListener('click', async () => {
    stopScanner();
    renderSwap();
    faceModal?.classList.add('is-open');

    activeScanner = new QrCameraScanner(faceVideo, {
      facingMode: 'user',
      onScan: (text) => processScannedText(text, stopScanner),
      onError: (err) => {
        console.warn('Front camera error:', err);
        showToast('Camera access denied or unavailable');
        stopScanner();
        openManualPasteModal();
      }
    });

    try {
      await activeScanner.start('user');
    } catch {
      stopScanner();
      openManualPasteModal();
    }
  });
}

// Manual Paste Modal setup
function openManualPasteModal() {
  const overlay = document.getElementById('modal-manual-paste');
  const input = document.getElementById('manual-paste-input');
  if (!overlay) return;
  if (input) input.value = '';
  overlay.classList.add('is-open', 'open');
  input?.focus();
}

function closeManualPasteModal() {
  document.getElementById('modal-manual-paste')?.classList.remove('is-open', 'open');
}

function setupManualPasteModal() {
  document.getElementById('btn-close-manual-paste')?.addEventListener('click', closeManualPasteModal);
  document.getElementById('modal-manual-paste')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeManualPasteModal();
  });

  // Paste from clipboard button
  document.getElementById('btn-manual-paste-clipboard')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const input = document.getElementById('manual-paste-input');
      if (input && text) input.value = text.trim();
    } catch {
      showToast('Clipboard access denied');
    }
  });

  // Form submit
  document.getElementById('form-manual-paste')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('manual-paste-input')?.value.trim();
    if (!text) return;
    closeManualPasteModal();
    await processScannedText(text);
  });
}

// Core scan processing with parseScan routing
async function processScannedText(text, onComplete) {
  const parsed = parseScan(text);
  if (!parsed) {
    showToast("That code isn't a Homebound card. Ask them to open their pass.");
    return;
  }

  onComplete?.();

  if (parsed.kind === 'card') {
    me = store.getMe();
    if (parsed.card.id === me?.id) {
      showToast("That's your own code!");
      return;
    }

    try {
      const loc = await getQuickLocation();
      const result = await store.recordScan({
        card: parsed.card,
        me,
        loc,
        now: new Date().toISOString()
      });
      showScanConfirmation(result.person, result.isNew);
    } catch (err) {
      console.error('Scan processing error:', err);
      showToast('Failed to record scan');
    }
  } else if (parsed.kind === 'party') {
    try {
      const loc = await getQuickLocation();
      const joined = store.getParty();
      if (joined && joined.id === parsed.party.id) {
        // Same code at the door on the way out: log the exit
        await store.exitParty({ now: new Date().toISOString(), loc });
        showToast(`Left ${parsed.party.name} · saved to your night`);
      } else {
        await store.joinParty(parsed.party, { now: new Date().toISOString(), loc });
        showToast(`Arrived at ${parsed.party.name} · saved to your night`);
      }
      renderSwap();
    } catch (err) {
      console.error('Party join error:', err);
      showToast('Failed to join party');
    }
  }
}

// URL Fragment Handler (#add= and #party=)
async function handleUrlFragment() {
  const hash = window.location.hash;
  if (!hash || (!hash.includes('add=') && !hash.includes('party='))) return;

  const fullUrl = window.location.href;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {}

  const parsed = parseScan(fullUrl);
  if (!parsed) return;

  me = store.getMe();
  vaultMeta = store.getVault();

  if (!me || !vaultMeta) {
    localStorage.setItem('hb_pending_scan', JSON.stringify({ url: fullUrl }));
    return;
  }

  await processScannedText(fullUrl);
}

// ============================================================================
// People Screen
// ============================================================================
function renderPeople() {
  const people = store.listPeople();
  const listEl = document.getElementById('people-list');
  const emptyEl = document.getElementById('people-empty');
  const countEl = document.getElementById('people-count');

  if (countEl) {
    countEl.textContent = `${people.length} ${people.length === 1 ? 'contact' : 'contacts'}`;
  }

  if (!listEl) return;
  listEl.innerHTML = '';

  if (people.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  for (const person of people) {
    const li = document.createElement('li');
    li.className = 'person-row';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `View contact ${person.n}`);

    const left = document.createElement('div');
    left.className = 'person-left';

    const avatar = document.createElement('div');
    avatar.className = 'person-avatar';
    avatar.textContent = (person.n || '?').charAt(0).toUpperCase();

    const info = document.createElement('div');
    info.style.overflow = 'hidden';

    const name = document.createElement('div');
    name.className = 'person-name';
    name.textContent = person.n || 'Unnamed';

    const details = document.createElement('div');
    details.className = 'person-subtext';
    const handles = [];
    if (person.p) handles.push(person.p);
    for (const plat of PLATFORMS) {
      if (person[plat.key]) handles.push(`@${person[plat.key]}`);
    }
    details.textContent = handles.join(' · ') || 'Contact';

    info.appendChild(name);
    info.appendChild(details);
    left.appendChild(avatar);
    left.appendChild(info);

    const arrow = document.createElement('span');
    arrow.className = 'text-mist';
    arrow.innerHTML = '&rsaquo;';
    arrow.style.fontSize = '22px';

    li.appendChild(left);
    li.appendChild(arrow);

    li.addEventListener('click', () => openContactModal(person));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openContactModal(person);
      }
    });

    listEl.appendChild(li);
  }
}

function openContactModal(person) {
  selectedContact = person;
  const overlay = document.getElementById('modal-contact');
  const nameEl = document.getElementById('contact-modal-name');
  const infoEl = document.getElementById('contact-modal-info');
  const socialsContainer = document.getElementById('contact-modal-socials');

  if (!overlay) return;

  if (nameEl) nameEl.textContent = person.n || 'Contact';

  if (infoEl) {
    infoEl.innerHTML = '';
    if (person.p) infoEl.innerHTML += `<div>Phone: ${person.p}</div>`;
    if (person.e) infoEl.innerHTML += `<div>Email: ${person.e}</div>`;
  }

  if (socialsContainer) {
    socialsContainer.innerHTML = '';
    if (person.p) {
      const call = document.createElement('a');
      call.className = 'social-capsule';
      call.href = `tel:${person.p}`;
      call.innerHTML = `${getPlatformSvg('call')}<span>Call</span>`;
      socialsContainer.appendChild(call);

      const text = document.createElement('a');
      text.className = 'social-capsule';
      text.href = `sms:${person.p}`;
      text.innerHTML = `${getPlatformSvg('sms')}<span>Text</span>`;
      socialsContainer.appendChild(text);
    }

    for (const plat of PLATFORMS) {
      if (person[plat.key]) {
        socialsContainer.appendChild(createSocialCapsule(plat.key, person[plat.key]));
      }
    }
  }

  overlay.classList.add('is-open', 'open');
}

function closeContactModal() {
  document.getElementById('modal-contact')?.classList.remove('is-open', 'open');
  selectedContact = null;
}

function setupContactModal() {
  document.getElementById('btn-close-contact')?.addEventListener('click', closeContactModal);
  document.getElementById('modal-contact')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeContactModal();
  });

  document.getElementById('cmodal-act-vcard')?.addEventListener('click', () => {
    if (selectedContact) downloadContactVCard(selectedContact);
  });

  document.getElementById('cmodal-act-delete')?.addEventListener('click', () => {
    if (!selectedContact) return;
    if (confirm(`Remove ${selectedContact.n} from contacts?`)) {
      store.removePerson(selectedContact.id);
      closeContactModal();
      renderPeople();
      showToast('Contact removed');
    }
  });
}

// ============================================================================
// Night Screen (Locked Passcode Keypad & Unlocked Timeline)
// ============================================================================
function renderNight() {
  const lockedScreen = document.getElementById('night-locked-screen');
  const unlockedScreen = document.getElementById('night-unlocked-screen');

  if (!unlockedKey) {
    if (lockedScreen) lockedScreen.style.display = 'flex';
    if (unlockedScreen) unlockedScreen.style.display = 'none';
    nightPad?.reset();
  } else {
    if (lockedScreen) lockedScreen.style.display = 'none';
    if (unlockedScreen) unlockedScreen.style.display = 'flex';
    renderUnlockedNight();
  }
}

// Unlock with the iPhone-style keypad. New vaults store `len` (passcode length) so a wrong
// code can shake as soon as the last dot fills. Older vaults have no `len`: try at 4 and 5
// (legacy) and 6, then extend to 8 dots.
function setupPasscodeKeypad() {
  const root = document.getElementById('night-keypad');
  if (!root) return;
  const knownLen = () => store.getVault()?.len || null;

  async function tryUnlock(attempt) {
    vaultMeta = store.getVault();
    if (!vaultMeta) return false;
    try {
      unlockedKey = await unlock(vaultMeta, attempt);
    } catch {
      return false;
    }
    lastUnlockedPasscode = attempt;
    animateThreadNext = true;
    if (!vaultMeta.len) {
      vaultMeta = { ...vaultMeta, len: attempt.length };
      store.setVault(vaultMeta);
    }
    resetAutoLockTimer();
    nightPad.reset();
    nightPad.setLength(knownLen() || 6);
    renderNight();
    if (isLegacyPasscode(attempt)) promptLegacyUpgrade();
    return true;
  }

  nightPad = mountKeypad(root, {
    title: 'Night log',
    subtitle: 'Enter your passcode',
    length: knownLen() || 6,
    onInput: async (code) => {
      // Legacy 4–5 digit vaults without a stored length
      if (!knownLen() && code.length >= 4 && code.length <= 5) await tryUnlock(code);
    },
    onComplete: async (code) => {
      if (await tryUnlock(code)) return;
      if (!knownLen() && code.length < 8) {
        // Unknown length: allow continuing up to 8 digits
        nightPad.setLength(code.length + 1);
        return;
      }
      nightPad.setLength(knownLen() || 6);
      nightPad.shake('Wrong passcode');
    },
  });

  document.getElementById('btn-lock-night')?.addEventListener('click', () => {
    lockNightLog();
    renderNight();
    showToast('Night log locked');
  });
}

// Legacy passcode migration prompt
async function promptLegacyUpgrade() {
  const newPass = await createPasscode({
    title: 'Choose a new passcode',
    subtitle: 'Homebound now uses 6 digits to protect your night log.',
    cancelLabel: null,
  });
  if (!newPass) return;
  try {
    const updatedMeta = await changePasscode(vaultMeta, lastUnlockedPasscode, newPass);
    vaultMeta = { ...updatedMeta, len: newPass.length };
    store.setVault(vaultMeta);
    lastUnlockedPasscode = newPass;
    showToast('Passcode updated');
  } catch {
    showToast('Couldn’t update the passcode. Try again from Settings.');
  }
}

// Unlocked Timeline & Morning Recap
async function renderUnlockedNight() {
  if (!unlockedKey) return;
  resetAutoLockTimer();

  const sealedList = store.listSealed();
  const decrypted = [];

  for (const sealed of sealedList) {
    try {
      const entry = await open(unlockedKey, sealed);
      if (entry) decrypted.push(entry);
    } catch {}
  }

  const tzOffsetMin = new Date().getTimezoneOffset();
  const nights = groupByNight(decrypted, { tzOffsetMin });

  renderMorningRecap(nights[0]);
  renderNightTimeline(nights, tzOffsetMin);
  setupNightExports(nights, decrypted);
}

function renderMorningRecap(latestNight) {
  const headline = document.getElementById('recap-headline');
  const body = document.getElementById('recap-body');
  const partiesLine = document.getElementById('recap-parties');
  const actionContainer = document.getElementById('recap-action-container');
  const actionBtn = document.getElementById('recap-action-btn');

  if (!latestNight || latestNight.entries.length === 0) {
    if (headline) headline.textContent = 'The morning after';
    if (body) body.textContent = 'No entries recorded yet. Tap Swap to scan contacts or log notes.';
    if (partiesLine) partiesLine.style.display = 'none';
    if (actionContainer) actionContainer.style.display = 'none';
    return;
  }

  const info = recap(latestNight);

  let text = '';
  if (info.people > 0) {
    text = `Last night you were with ${info.people} ${info.people === 1 ? 'person' : 'people'}.`;
    if (info.lastWith) {
      const lastTime = formatTime(info.lastWith.at, latestNight.tzOffsetMin);
      text += ` Last with ${info.lastWith.name} at ${lastTime}.`;
    }
  } else {
    text = 'Your recorded timeline:';
  }

  if (info.wentHome) {
    const homeTime = formatTime(info.wentHome, latestNight.tzOffsetMin);
    text += ` Got home at ${homeTime}.`;
  }

  if (body) body.textContent = text;

  // Parties mention
  if (partiesLine) {
    if (info.parties && info.parties.length > 0) {
      partiesLine.textContent = `Parties: ${info.parties.join(', ')}`;
      partiesLine.style.display = 'block';
    } else {
      partiesLine.style.display = 'none';
    }
  }

  // Action button to text last person
  if (info.lastWith && actionContainer && actionBtn) {
    const person = store.getPerson(info.lastWith.personId);
    if (person && person.p) {
      actionBtn.href = `sms:${person.p}`;
      actionBtn.textContent = `Text ${person.n}`;
      actionContainer.style.display = 'inline-flex';
    } else {
      actionContainer.style.display = 'none';
    }
  } else if (actionContainer) {
    actionContainer.style.display = 'none';
  }
}

const NODE_STYLE = {
  met: { cls: 'tl-node-met', color: 'var(--signal)' },
  again: { cls: 'tl-node-again', color: 'var(--signal)' },
  arrive: { cls: 'tl-node-arrive', color: 'var(--lilac)' },
  leave: { cls: 'tl-node-leave', color: 'var(--lilac)' },
  note: { cls: 'tl-node-note', color: 'var(--lilac)' },
  home: { cls: 'tl-node-home', color: 'var(--dawn)' },
};

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '•';
}

// Night timeline: time | node on a fluid thread | what happened
function renderNightTimeline(nights, tzOffsetMin) {
  const container = document.getElementById('night-timeline-container');
  if (!container) return;
  while (threadCleanups.length) threadCleanups.pop()();
  container.innerHTML = '';
  const animate = animateThreadNext;
  animateThreadNext = false;
  const lists = [];

  for (const night of nights) {
    const group = document.createElement('section');
    group.className = 'night-group';

    const label = document.createElement('h3');
    label.className = 'timeline-night-label';
    label.textContent = night.label;
    group.appendChild(label);

    const list = document.createElement('div');
    list.className = 'tl-list';

    for (const entry of night.entries) {
      const kind = entry.type === 'met' && entry.again ? 'again' : entry.type;
      const style = NODE_STYLE[kind] || NODE_STYLE.note;

      const row = document.createElement('div');
      row.className = `tl-row tl-row-${kind}`;

      const time = document.createElement('div');
      time.className = 'tl-time';
      time.textContent = formatTime(entry.at, tzOffsetMin);

      const rail = document.createElement('div');
      rail.className = 'tl-rail';
      const node = document.createElement('span');
      node.className = `tl-node ${style.cls}`;
      node.dataset.color = style.color;
      if (kind === 'met') node.textContent = initials(entry.name);
      if (kind === 'home') node.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>';
      rail.appendChild(node);

      const content = document.createElement('div');
      content.className = 'tl-content';
      const text = document.createElement('p');
      text.className = 'tl-text';
      if (entry.type === 'met') {
        text.textContent = entry.again ? `Still with ${entry.name}` : `Met ${entry.name}`;
        const person = entry.personId && store.getPerson(entry.personId);
        if (person) {
          text.classList.add('tl-person');
          text.tabIndex = 0;
          text.setAttribute('role', 'button');
          const openIt = () => { selectedContact = person; openContactModal?.(person); };
          text.addEventListener('click', openIt);
          text.addEventListener('keydown', (e) => { if (e.key === 'Enter') openIt(); });
        }
      } else if (entry.type === 'home') {
        text.textContent = 'Home';
      } else if (entry.type === 'arrive') {
        text.textContent = `Arrived at ${entry.name}`;
      } else if (entry.type === 'leave') {
        text.textContent = `Left ${entry.name}`;
      } else {
        text.textContent = entry.text || 'Note';
      }
      content.appendChild(text);

      if (entry.loc && typeof entry.loc.lat === 'number' && typeof entry.loc.lng === 'number') {
        const mapLink = document.createElement('a');
        mapLink.className = 'tl-map';
        mapLink.href = `https://maps.apple.com/?ll=${entry.loc.lat},${entry.loc.lng}`;
        mapLink.target = '_blank';
        mapLink.rel = 'noopener noreferrer';
        mapLink.textContent = 'Map';
        content.appendChild(mapLink);
      }

      row.append(time, rail, content);
      list.appendChild(row);
    }

    group.appendChild(list);
    container.appendChild(group);
    lists.push(list);
  }

  // Measure after layout (and after fonts settle) so the thread hits each node's center
  const draw = () => lists.forEach((list, i) => threadCleanups.push(drawThread(list, { animate: animate && i === 0 })));
  requestAnimationFrame(() => (document.fonts?.ready || Promise.resolve()).then(draw));
}

function setupNightExports(nights, decryptedEntries) {
  const shareBtn = document.getElementById('btn-share-night');
  if (shareBtn) {
    shareBtn.onclick = async () => {
      if (!nights || nights.length === 0) {
        showToast('No night entries to share');
        return;
      }
      const text = shareText(nights[0]);
      if (navigator.share) {
        try {
          await navigator.share({ title: `Homebound - ${nights[0].label}`, text });
        } catch {}
      } else if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(text);
          showToast('Copied night recap to clipboard');
        } catch {
          showToast('Failed to copy');
        }
      }
    };
  }

  const downloadBtn = document.getElementById('btn-download-log');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      try {
        const json = JSON.stringify(decryptedEntries, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `homebound-log-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Decrypted log downloaded');
      } catch (e) {
        console.error('Download log failed:', e);
      }
    };
  }
}

// ============================================================================
// Settings: You & Host a Party
// ============================================================================
function setupSettings() {
  const modal = document.getElementById('modal-settings');
  const segYou = document.getElementById('seg-btn-you');
  const segHost = document.getElementById('seg-btn-host');
  const panelYou = document.getElementById('settings-panel-you');
  const panelHost = document.getElementById('settings-panel-host');

  document.getElementById('btn-settings-open')?.addEventListener('click', () => {
    modal?.classList.add('is-open', 'open');
    populateSettingsYou();
    populateSettingsHost();
  });

  document.getElementById('btn-close-settings')?.addEventListener('click', () => {
    modal?.classList.remove('is-open', 'open');
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('is-open', 'open');
  });

  // Segmented toggle
  segYou?.addEventListener('click', () => {
    segYou.classList.add('active');
    segHost.classList.remove('active');
    panelYou.style.display = 'flex';
    panelHost.style.display = 'none';
  });

  segHost?.addEventListener('click', () => {
    segHost.classList.add('active');
    segYou.classList.remove('active');
    panelHost.style.display = 'flex';
    panelYou.style.display = 'none';
  });

  setupSettingsYou();
  setupSettingsHost();
}

// Social block builder for Settings and Onboarding
function buildSocialBlock(platform, initialHandle, initialShare, onHandleChange, onShareChange) {
  const wrap = document.createElement('div');
  wrap.className = 'social-setting-block';

  const top = document.createElement('div');
  top.className = 'social-setting-top';

  const name = document.createElement('div');
  name.className = 'social-setting-name';
  name.innerHTML = `${getPlatformSvg(platform.key)}<span>${platform.label}</span>`;

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle-share-label';
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = initialShare !== false;
  chk.addEventListener('change', () => onShareChange(chk.checked));
  toggleLabel.appendChild(chk);
  toggleLabel.appendChild(document.createTextNode('Share in my code'));

  top.appendChild(name);
  top.appendChild(toggleLabel);
  wrap.appendChild(top);

  // Input & preview
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.placeholder = platform.placeholder;
  input.value = initialHandle || '';
  input.style.minHeight = '40px';
  input.addEventListener('input', () => {
    const clean = input.value.trim().replace(/^@/, '');
    onHandleChange(clean);
  });

  // Actions: Connect, Paste Link
  const actions = document.createElement('div');
  actions.className = 'social-actions-strip';

  const connectBtn = document.createElement('button');
  connectBtn.type = 'button';
  connectBtn.className = 'btn-mini-capsule';
  connectBtn.textContent = 'Connect';

  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'btn-mini-capsule';
  pasteBtn.textContent = 'Paste link';

  actions.appendChild(connectBtn);
  actions.appendChild(pasteBtn);

  // Help info box (revealed on Connect)
  const helpBox = document.createElement('div');
  helpBox.className = 'text-13 text-mist';
  helpBox.style.display = 'none';
  helpBox.style.padding = '8px';
  helpBox.style.borderRadius = '8px';
  helpBox.style.background = 'rgba(255, 255, 255, 0.05)';
  helpBox.textContent = platform.shareHelp;

  connectBtn.addEventListener('click', () => {
    const urls = {
      ig: 'https://instagram.com/',
      sc: 'https://snapchat.com/',
      tt: 'https://www.tiktok.com/',
      x: 'https://x.com/',
      li: 'https://www.linkedin.com/'
    };
    window.open(urls[platform.key] || 'https://instagram.com/', '_blank');
    helpBox.style.display = 'block';
  });

  pasteBtn.addEventListener('click', async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = prompt('Paste profile link:') || '';
    }
    if (text) {
      const parsed = parseProfileLink(text);
      if (parsed && parsed.handle) {
        input.value = parsed.handle;
        onHandleChange(parsed.handle);
        showToast(`Linked @${parsed.handle}`);
      } else {
        const clean = text.trim().replace(/^@/, '');
        input.value = clean;
        onHandleChange(clean);
      }
    }
  });

  wrap.appendChild(actions);
  wrap.appendChild(helpBox);
  wrap.appendChild(input);

  return wrap;
}

// YOU Settings
function populateSettingsYou() {
  me = store.getMe();
  const settings = store.getSettings();
  const share = store.getShare();

  const editName = document.getElementById('edit-card-name');
  const editPhone = document.getElementById('edit-card-phone');
  const editEmail = document.getElementById('edit-card-email');

  if (editName && me) editName.value = me.n || '';
  if (editPhone && me) editPhone.value = me.p || '';
  if (editEmail && me) editEmail.value = me.e || '';

  // Social list
  const container = document.getElementById('settings-socials-list');
  if (container && me) {
    container.innerHTML = '';
    for (const plat of PLATFORMS) {
      const block = buildSocialBlock(
        plat,
        me[plat.key],
        share[plat.key],
        (handle) => {
          if (handle) me[plat.key] = handle; else delete me[plat.key];
        },
        (isShared) => {
          store.setShare({ [plat.key]: isShared });
        }
      );
      container.appendChild(block);
    }
  }

  const locToggle = document.getElementById('settings-location-toggle');
  if (locToggle) locToggle.checked = Boolean(settings.location);

  const autolockSel = document.getElementById('settings-autolock-select');
  if (autolockSel) autolockSel.value = String(settings.autoLockMin || 5);
}

function setupSettingsYou() {
  // Form submit
  document.getElementById('form-edit-card')?.addEventListener('submit', (e) => {
    e.preventDefault();
    me = store.getMe() || { id: newId() };

    const name = document.getElementById('edit-card-name')?.value.trim();
    if (!name) return;

    me.n = name;
    const phone = document.getElementById('edit-card-phone')?.value.trim();
    const email = document.getElementById('edit-card-email')?.value.trim();

    if (phone) me.p = phone; else delete me.p;
    if (email) me.e = email; else delete me.e;

    store.setMe(me);
    renderSwap();
    showToast('Card updated');
    document.getElementById('modal-settings')?.classList.remove('is-open', 'open');
  });

  // Location setting
  document.getElementById('settings-location-toggle')?.addEventListener('change', (e) => {
    store.setSettings({ location: e.target.checked });
  });

  // Auto-lock setting
  document.getElementById('settings-autolock-select')?.addEventListener('change', (e) => {
    store.setSettings({ autoLockMin: Number(e.target.value) || 5 });
    resetAutoLockTimer();
  });

  // Change passcode: current → new → confirm, all on the keypad
  document.getElementById('btn-change-passcode')?.addEventListener('click', async () => {
    vaultMeta = store.getVault();
    if (!vaultMeta) return;
    const oldPass = await askPasscode({
      title: 'Enter your current passcode',
      length: vaultMeta.len || 6,
      check: async (c) => {
        try { await unlock(vaultMeta, c); return null; } catch { return 'Wrong passcode'; }
      },
    });
    if (!oldPass) return;
    const newPass = await createPasscode({ title: 'Enter a new passcode' });
    if (!newPass) return;
    try {
      const updatedMeta = await changePasscode(vaultMeta, oldPass, newPass);
      vaultMeta = { ...updatedMeta, len: newPass.length };
      store.setVault(vaultMeta);
      nightPad?.setLength(newPass.length);
      showToast('Passcode changed');
    } catch {
      showToast('Couldn’t change the passcode');
    }
  });

  // Delete everything
  document.getElementById('btn-delete-everything')?.addEventListener('click', () => {
    const sure = confirm(
      'Are you absolutely sure?\n\nThis will permanently delete all your contacts, sealed night logs, and encryption keys from this device.'
    );
    if (!sure) return;

    store.wipe();
    lockNightLog();
    document.getElementById('modal-settings')?.classList.remove('is-open', 'open');
    checkOnboarding();
    showToast('All data erased');
  });
}

// HOST A PARTY Settings
let currentViewingParty = null;

function populateSettingsHost() {
  const hostedList = store.listHosted();
  const activeSection = document.getElementById('active-hosted-section');
  const activeName = document.getElementById('active-hosted-name');
  const activeTime = document.getElementById('active-hosted-time');
  const historyList = document.getElementById('hosted-parties-list');

  // If there's an active or newest hosted party
  if (hostedList.length > 0) {
    const active = hostedList[hostedList.length - 1];
    currentViewingParty = active;
    if (activeSection) activeSection.style.display = 'flex';
    if (activeName) activeName.textContent = active.name;
    if (activeTime) {
      const start = new Date(active.startsAt);
      activeTime.textContent = `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${active.host.n}`;
    }
  } else {
    currentViewingParty = null;
    if (activeSection) activeSection.style.display = 'none';
  }

  // Populate history
  if (historyList) {
    historyList.innerHTML = '';
    for (const party of [...hostedList].reverse()) {
      const li = document.createElement('li');
      li.className = 'banner-party';
      li.style.padding = '10px 14px';
      li.innerHTML = `
        <div style="overflow: hidden;">
          <div class="text-15 text-ink" style="font-weight: 700;">${party.name}</div>
          <div class="text-13 text-mist">${new Date(party.startsAt).toLocaleDateString()}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="banner-pill-btn" data-act="view" data-id="${party.id}">QR</button>
          <button type="button" class="banner-pill-btn text-danger" data-act="del" data-id="${party.id}">&times;</button>
        </div>
      `;
      historyList.appendChild(li);
    }
  }

  // Prefill host name & phone from Me
  me = store.getMe();
  const hostNameInput = document.getElementById('party-host-name');
  const hostPhoneInput = document.getElementById('party-host-phone');
  if (hostNameInput && me && !hostNameInput.value) hostNameInput.value = me.n || '';
  if (hostPhoneInput && me && !hostPhoneInput.value) hostPhoneInput.value = me.p || '';
}

function setupSettingsHost() {
  const form = document.getElementById('form-host-party');

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('party-name')?.value.trim();
    const startsAt = document.getElementById('party-start')?.value;
    const endsAt = document.getElementById('party-end')?.value;
    const hostName = document.getElementById('party-host-name')?.value.trim();
    const hostPhone = document.getElementById('party-host-phone')?.value.trim();
    const ride = document.getElementById('party-ride')?.value.trim();
    const note = document.getElementById('party-note')?.value.trim();
    const askHome = document.getElementById('party-ask-home')?.checked;

    if (!name || !startsAt || !endsAt || !hostName) return;

    const party = {
      v: 1,
      id: newId(),
      name,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      host: { n: hostName }
    };
    if (hostPhone) party.host.p = hostPhone;
    if (ride) party.ride = ride;
    if (note) party.note = note;
    if (askHome) party.ask = { home: true };

    store.saveHosted(party);
    currentViewingParty = party;
    populateSettingsHost();
    form.reset();
    showToast('Party created');
    openPartyQrModal(party);
  });

  // History buttons delegation
  document.getElementById('hosted-parties-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const party = store.listHosted().find(p => p.id === id);

    if (act === 'view' && party) {
      currentViewingParty = party;
      openPartyQrModal(party);
    } else if (act === 'del' && id) {
      if (confirm('Delete this party from your hosted list?')) {
        store.removeHosted(id);
        populateSettingsHost();
      }
    }
  });

  // Active party buttons
  document.getElementById('btn-view-party-qr')?.addEventListener('click', () => {
    if (currentViewingParty) openPartyQrModal(currentViewingParty);
  });

  document.getElementById('btn-share-party-link')?.addEventListener('click', async () => {
    if (!currentViewingParty) return;
    const appUrl = window.location.href.split('#')[0];
    const url = partyUrl(appUrl, currentViewingParty);
    if (navigator.share) {
      try {
        await navigator.share({ title: currentViewingParty.name, url });
      } catch {}
    } else {
      navigator.clipboard.writeText(url);
      showToast('Party link copied');
    }
  });

  document.getElementById('btn-print-party')?.addEventListener('click', () => {
    if (currentViewingParty) printPartyFlyer(currentViewingParty);
  });

  document.getElementById('btn-end-party')?.addEventListener('click', () => {
    if (!currentViewingParty) return;
    if (confirm(`End and delete ${currentViewingParty.name}?`)) {
      store.removeHosted(currentViewingParty.id);
      populateSettingsHost();
      showToast('Party ended');
    }
  });
}

// Party QR Modal & Flyer Print
function openPartyQrModal(party) {
  const modal = document.getElementById('modal-party-qr');
  const title = document.getElementById('party-qr-modal-title');
  const qrContainer = document.getElementById('party-qr-display-container');

  if (!modal || !party) return;
  if (title) title.textContent = party.name;

  if (qrContainer) {
    const appUrl = window.location.href.split('#')[0];
    const encoded = partyUrl(appUrl, party);
    try {
      qrContainer.innerHTML = generateQRSvg(encoded, {
        size: 260,
        margin: 1,
        color: '#000000',
        bgColor: '#FFFFFF'
      });
    } catch (e) {
      console.warn('Party QR generation error:', e);
    }
  }

  document.getElementById('btn-close-party-qr')?.addEventListener('click', () => {
    modal.classList.remove('is-open', 'open');
  }, { once: true });

  document.getElementById('btn-qr-modal-share')?.addEventListener('click', async () => {
    const appUrl = window.location.href.split('#')[0];
    const url = partyUrl(appUrl, party);
    if (navigator.share) {
      try { await navigator.share({ title: party.name, url }); } catch {}
    } else {
      navigator.clipboard.writeText(url);
      showToast('Party link copied');
    }
  });

  document.getElementById('btn-qr-modal-print')?.addEventListener('click', () => {
    printPartyFlyer(party);
  });

  modal.classList.add('is-open', 'open');
}

function printPartyFlyer(party) {
  const flyer = document.getElementById('print-party-flyer');
  const nameEl = document.getElementById('print-party-name');
  const timesEl = document.getElementById('print-party-times');
  const qrEl = document.getElementById('print-qr-target');
  const hostEl = document.getElementById('print-party-host');
  const rideEl = document.getElementById('print-party-ride');
  const noteEl = document.getElementById('print-party-note');

  if (!flyer || !party) return;

  if (nameEl) nameEl.textContent = party.name;
  if (timesEl) {
    const s = new Date(party.startsAt);
    const e = new Date(party.endsAt);
    timesEl.textContent = `${s.toLocaleString()} – ${e.toLocaleTimeString()}`;
  }
  if (hostEl) hostEl.textContent = `Host: ${party.host.n}${party.host.p ? ' · ' + party.host.p : ''}`;
  if (rideEl) rideEl.textContent = party.ride ? `Ride info: ${party.ride}` : '';
  if (noteEl) noteEl.textContent = party.note ? `Rules / Note: ${party.note}` : '';

  if (qrEl) {
    const appUrl = window.location.href.split('#')[0];
    const url = partyUrl(appUrl, party);
    try {
      qrEl.innerHTML = generateQRSvg(url, { size: 300, margin: 1, color: '#000000', bgColor: '#FFFFFF' });
    } catch {}
  }

  window.print();
}

// Joined Party Help & Ride Modals
function setupPartyBannerActions() {
  document.getElementById('btn-party-help')?.addEventListener('click', () => {
    const party = store.getParty();
    if (!party) return;
    openPartyInfoModal('Help & Contact', `
      <div class="text-17 text-ink" style="font-weight: 700;">Host: ${party.host.n}</div>
      ${party.host.p ? `
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <a href="tel:${party.host.p}" class="social-capsule">${getPlatformSvg('call')}<span>Call ${party.host.n}</span></a>
          <a href="sms:${party.host.p}" class="social-capsule">${getPlatformSvg('sms')}<span>Text</span></a>
        </div>
      ` : '<p class="text-14 text-mist">No phone number provided by host.</p>'}
      ${party.note ? `<div style="margin-top: 14px;"><strong class="text-14 text-mist">House rules:</strong><p class="text-15 text-ink">${party.note}</p></div>` : ''}
    `);
  });

  document.getElementById('btn-party-ride')?.addEventListener('click', () => {
    const party = store.getParty();
    if (!party) return;
    openPartyInfoModal('Ride & Pickup', `
      <div class="text-17 text-ink" style="font-weight: 700;">Pickup instructions:</div>
      <p class="text-15 text-mist" style="margin-top: 6px;">${party.ride || 'No specific pickup spot specified. Coordinate with your group outside.'}</p>
    `);
  });

  document.getElementById('btn-party-leave')?.addEventListener('click', () => {
    const party = store.getParty();
    if (!party) return;
    if (confirm(`Leave party "${party.name}"?`)) {
      store.leaveParty();
      renderSwap();
      showToast('Left party');
    }
  });
}

function openPartyInfoModal(title, htmlContent) {
  const modal = document.getElementById('modal-party-info');
  const titleEl = document.getElementById('party-info-modal-title');
  const contentEl = document.getElementById('party-info-content');

  if (!modal) return;
  if (titleEl) titleEl.textContent = title;
  if (contentEl) contentEl.innerHTML = htmlContent;

  document.getElementById('btn-close-party-info')?.addEventListener('click', () => {
    modal.classList.remove('is-open', 'open');
  }, { once: true });

  modal.classList.add('is-open', 'open');
}

// ============================================================================
// Onboarding Flow
// ============================================================================
let onboardCardData = null;

function checkOnboarding() {
  me = store.getMe();
  vaultMeta = store.getVault();

  const backdrop = document.getElementById('modal-onboarding');
  if (!me || !vaultMeta) {
    if (backdrop) {
      backdrop.classList.add('is-open', 'open');
      backdrop.style.display = 'flex';
    }
    setupOnboardingSocials();
    showOnboardingStep(1);
  } else {
    if (backdrop) {
      backdrop.classList.remove('is-open', 'open');
      backdrop.style.display = 'none';
    }
    renderSwap();
  }
}

function showOnboardingStep(step) {
  const s1 = document.getElementById('onboarding-step-1');
  const s2 = document.getElementById('onboarding-step-2');
  if (s1) s1.style.display = step === 1 ? 'block' : 'none';
  if (s2) s2.style.display = step === 2 ? 'block' : 'none';
}

function setupOnboardingSocials() {
  const container = document.getElementById('onboard-socials-list');
  if (!container) return;
  container.innerHTML = '';

  onboardCardData = onboardCardData || { v: 1, id: newId() };

  for (const plat of PLATFORMS) {
    const block = buildSocialBlock(
      plat,
      onboardCardData[plat.key],
      true,
      (handle) => {
        if (handle) onboardCardData[plat.key] = handle; else delete onboardCardData[plat.key];
      },
      (isShared) => {
        store.setShare({ [plat.key]: isShared });
      }
    );
    container.appendChild(block);
  }
}

function setupOnboarding() {
  const formCard = document.getElementById('form-onboard-card');

  // Step 1: Your Card
  formCard?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('onboard-name')?.value.trim();
    if (!name) return;

    const phone = document.getElementById('onboard-phone')?.value.trim();
    const email = document.getElementById('onboard-email')?.value.trim();

    onboardCardData = onboardCardData || { v: 1, id: newId() };
    onboardCardData.n = name;
    if (phone) onboardCardData.p = phone; else delete onboardCardData.p;
    if (email) onboardCardData.e = email; else delete onboardCardData.e;

    finishOnboarding();
  });

}

async function finishOnboarding() {
  const pass = await createPasscode({
    title: 'Create a passcode',
    subtitle: 'It opens your private night log. If you forget it, the log can’t be recovered.',
    cancelLabel: 'Back',
  });
  if (!pass) return; // back to the card form

  try {
    const meta = await createVault(pass);
    store.setMe(onboardCardData);
    store.setVault({ ...meta, len: pass.length });

    // Reload me/vaultMeta, close the onboarding modal (classes and inline style), render Swap
    checkOnboarding();
    nightPad?.setLength(pass.length);
    showToast('Welcome to Homebound');

    const pendingRaw = localStorage.getItem('hb_pending_scan');
    if (pendingRaw) {
      localStorage.removeItem('hb_pending_scan');
      try {
        const pending = JSON.parse(pendingRaw);
        if (pending?.url) await processScannedText(pending.url);
      } catch {}
    }
  } catch (err) {
    console.error('Onboarding vault creation error:', err);
    showToast('Couldn’t set up the night log. Try again.');
  }
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  setupIosPrompt();
  setupPassTilt();
  setupQuickActions();
  setupNoteModal();
  setupScanners();
  setupManualPasteModal();
  setupContactModal();
  setupPasscodeKeypad();
  setupSettings();
  setupPartyBannerActions();
  setupOnboarding();

  // Tab navigation listeners
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.view);
    });
  });

  // Check onboarding status
  checkOnboarding();

  // Handle URL fragments (#add= or #party=)
  handleUrlFragment();
  window.addEventListener('hashchange', handleUrlFragment);
});
