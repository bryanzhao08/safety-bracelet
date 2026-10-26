// web/app/app.js - Homebound PWA Client Application

import { newId, encodeCard, decodeCard, cardUrl, parseScan, vcard } from './lib/card.js';
import { createVault, seal, unlock, open, changePasscode } from './lib/vault.js';
import { createStore } from './lib/store.js';
import { groupByNight, recap, shareText, formatTime } from './lib/nights.js';
import { generateQRSvg } from '../shared/qr.js';
import { QrCameraScanner } from './ui/scanner.js';

// Initialize Store with localStorage
const store = createStore(localStorage);

// State
let currentTab = 'swap';
let me = store.getMe();
let vaultMeta = store.getVault();
let unlockedKey = null; // Stored in memory only!
let autoLockTimer = null;
let currentPasscodeAttempt = '';
let activeScanner = null;
let selectedContact = null;
let confirmAutoReturnTimer = null;

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
// Navigation & Views
// ============================================================================
function switchTab(tabName) {
  currentTab = tabName;

  // Update nav buttons
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === tabName);
  });

  // Toggle views
  document.getElementById('view-swap').style.display = tabName === 'swap' ? 'flex' : 'none';
  document.getElementById('view-people').style.display = tabName === 'people' ? 'flex' : 'none';
  document.getElementById('view-night').style.display = tabName === 'night' ? 'flex' : 'none';

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
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
  currentPasscodeAttempt = '';
  updatePasscodeDots();
}

// Invariant: Auto-lock when tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden && unlockedKey) {
    lockNightLog();
    if (currentTab === 'night') {
      renderNight();
    }
  }
});

// ============================================================================
// Swap Screen & Ticket Stub
// ============================================================================
function renderSwap() {
  me = store.getMe();
  if (!me) return;

  const nameEl = document.getElementById('stub-name');
  const idEl = document.getElementById('stub-id-badge');
  const handlesEl = document.getElementById('stub-handles');
  const qrContainer = document.getElementById('stub-qr-container');

  if (nameEl) nameEl.textContent = me.n || 'Your Name';
  if (idEl) idEl.textContent = me.id ? `#${me.id.slice(0, 5)}` : '';

  if (handlesEl) {
    handlesEl.innerHTML = '';
    if (me.p) {
      const pSpan = document.createElement('span');
      pSpan.textContent = me.p;
      handlesEl.appendChild(pSpan);
    }
    if (me.ig) {
      const igSpan = document.createElement('span');
      igSpan.textContent = `@${me.ig}`;
      handlesEl.appendChild(igSpan);
    }
    if (me.sc) {
      const scSpan = document.createElement('span');
      scSpan.textContent = `sc:${me.sc}`;
      handlesEl.appendChild(scSpan);
    }
  }

  // Generate QR SVG
  if (qrContainer) {
    const appUrl = window.location.href.split('#')[0];
    const encodedUrl = cardUrl(appUrl, me);
    try {
      const svgMarkup = generateQRSvg(encodedUrl, {
        size: 240,
        margin: 1,
        color: '#1B2340',
        bgColor: '#FFFFFF'
      });
      qrContainer.innerHTML = svgMarkup;
    } catch (e) {
      console.warn('QR generation failed:', e);
    }
  }

  // Also update Face to face mini stub
  const miniName = document.getElementById('face-mini-name');
  const miniQr = document.getElementById('face-mini-qr');
  if (miniName) miniName.textContent = me.n || '';
  if (miniQr && qrContainer) {
    miniQr.innerHTML = qrContainer.innerHTML;
  }
}

// Quick Actions Menu ("..." button)
function setupQuickMenu() {
  const menuBtn = document.getElementById('btn-swap-menu');
  const backdrop = document.getElementById('quick-menu-backdrop');
  const sheet = document.getElementById('quick-menu-sheet');
  const cancelBtn = document.getElementById('quick-btn-cancel');

  function openMenu() {
    backdrop?.classList.add('is-open');
    sheet?.classList.add('is-open');
  }

  function closeMenu() {
    backdrop?.classList.remove('is-open');
    sheet?.classList.remove('is-open');
  }

  menuBtn?.addEventListener('click', openMenu);
  backdrop?.addEventListener('click', closeMenu);
  cancelBtn?.addEventListener('click', closeMenu);

  // Quick Action: "Add a note"
  document.getElementById('quick-btn-note')?.addEventListener('click', () => {
    closeMenu();
    openNoteModal();
  });

  // Quick Action: "I'm home"
  document.getElementById('quick-btn-home')?.addEventListener('click', async () => {
    closeMenu();
    await recordHomeEntry();
  });
}

// Record "I'm home" entry
async function recordHomeEntry() {
  vaultMeta = store.getVault();
  if (!vaultMeta) {
    showToast('Vault not initialized');
    return;
  }

  try {
    const loc = await getQuickLocation();
    const entry = {
      id: newId(),
      type: 'home',
      at: new Date().toISOString()
    };
    if (loc) entry.loc = loc;

    const sealed = await seal(vaultMeta, entry);
    store.appendSealed(sealed);
    showToast('Saved to your night');
  } catch (err) {
    console.error('Failed to log home entry:', err);
    showToast('Failed to save entry');
  }
}

// Add Note Modal
function openNoteModal() {
  const backdrop = document.getElementById('modal-note-backdrop');
  const textarea = document.getElementById('note-text');
  const charCount = document.getElementById('note-char-count');
  if (!backdrop || !textarea) return;

  textarea.value = '';
  if (charCount) charCount.textContent = '0 / 280';
  backdrop.classList.add('is-open');
  textarea.focus();
}

function closeNoteModal() {
  document.getElementById('modal-note-backdrop')?.classList.remove('is-open');
}

function setupNoteModal() {
  const form = document.getElementById('form-note');
  const textarea = document.getElementById('note-text');
  const charCount = document.getElementById('note-char-count');
  const closeBtn = document.getElementById('btn-close-note');

  closeBtn?.addEventListener('click', closeNoteModal);
  document.getElementById('modal-note-backdrop')?.addEventListener('click', (e) => {
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

    vaultMeta = store.getVault();
    if (!vaultMeta) return;

    try {
      const loc = await getQuickLocation();
      const entry = {
        id: newId(),
        type: 'note',
        at: new Date().toISOString(),
        text
      };
      if (loc) entry.loc = loc;

      const sealed = await seal(vaultMeta, entry);
      store.appendSealed(sealed);
      closeNoteModal();
      showToast('Saved to your night');
    } catch (err) {
      console.error('Failed to seal note:', err);
      showToast('Failed to save note');
    }
  });
}

// ============================================================================
// Camera QR Scanners
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

  // Scan theirs (Back Camera)
  btnScanTheirs?.addEventListener('click', async () => {
    stopScanner();
    theirsModal?.classList.add('is-open');

    activeScanner = new QrCameraScanner(theirsVideo, {
      facingMode: 'environment',
      onScan: (text) => handleScannedData(text, stopScanner),
      onError: (err) => {
        console.warn('Scanner error:', err);
        showToast('Camera access denied or unavailable');
        stopScanner();
      }
    });

    try {
      await activeScanner.start('environment');
    } catch {
      stopScanner();
    }
  });

  // Face to face (Front Camera + Your QR)
  btnFaceToFace?.addEventListener('click', async () => {
    stopScanner();
    faceModal?.classList.add('is-open');

    activeScanner = new QrCameraScanner(faceVideo, {
      facingMode: 'user',
      onScan: (text) => handleScannedData(text, stopScanner),
      onError: (err) => {
        console.warn('Front camera error:', err);
        showToast('Camera access denied or unavailable');
        stopScanner();
      }
    });

    try {
      await activeScanner.start('user');
    } catch {
      stopScanner();
    }
  });
}

// Process Scanned QR Text
async function handleScannedData(text, onComplete) {
  const card = parseScan(text);
  if (!card) return;

  me = store.getMe();
  if (card.id === me?.id) {
    showToast("That's your own ticket code!");
    return;
  }

  onComplete?.();

  try {
    const loc = await getQuickLocation();
    const result = await store.recordScan({
      card,
      me,
      loc,
      now: new Date().toISOString()
    });

    showScanConfirmation(result.person, result.isNew);
  } catch (err) {
    console.error('Scan processing error:', err);
    showToast('Failed to record scan');
  }
}

// ============================================================================
// Full-Screen Pink Scan Confirmation
// ============================================================================
function showScanConfirmation(person, isNew) {
  const screen = document.getElementById('scan-confirm-screen');
  const heading = document.getElementById('confirm-heading');
  const subhead = document.getElementById('confirm-subhead');
  const actCall = document.getElementById('confirm-act-call');
  const actText = document.getElementById('confirm-act-text');
  const actIg = document.getElementById('confirm-act-ig');
  const actVcard = document.getElementById('confirm-act-vcard');
  const doneBtn = document.getElementById('btn-confirm-done');

  if (!screen) return;

  const displayName = person.n || 'Friend';
  if (heading) {
    heading.textContent = isNew ? `Added ${displayName}` : `Still with ${displayName}`;
  }
  if (subhead) {
    subhead.textContent = isNew
      ? 'Saved to your contacts and private night log.'
      : 'Added another timestamp to your night log.';
  }

  // Call & Text
  if (person.p) {
    if (actCall) {
      actCall.href = `tel:${person.p}`;
      actCall.style.display = 'flex';
    }
    if (actText) {
      actText.href = `sms:${person.p}`;
      actText.style.display = 'flex';
    }
  } else {
    if (actCall) actCall.style.display = 'none';
    if (actText) actText.style.display = 'none';
  }

  // Instagram
  if (person.ig && actIg) {
    actIg.href = `https://instagram.com/${person.ig}`;
    actIg.style.display = 'flex';
  } else if (actIg) {
    actIg.style.display = 'none';
  }

  // Save vCard
  if (actVcard) {
    actVcard.onclick = () => downloadVCard(person);
  }

  screen.classList.add('is-open');

  function closeConfirm() {
    if (confirmAutoReturnTimer) {
      clearTimeout(confirmAutoReturnTimer);
      confirmAutoReturnTimer = null;
    }
    screen.classList.remove('is-open');
    switchTab('swap');
  }

  doneBtn.onclick = closeConfirm;

  // Auto-return after 4.5 seconds if untouched
  if (confirmAutoReturnTimer) clearTimeout(confirmAutoReturnTimer);
  confirmAutoReturnTimer = setTimeout(closeConfirm, 4500);
}

// Helper: Download vCard file
function downloadVCard(card) {
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
// #add= Fragment Handler on Page Load / Hash Change
// ============================================================================
async function handleUrlAddFragment() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('add=')) return;

  const card = parseScan(window.location.href);
  // Invariant: Strip fragment immediately to keep URL clean and private
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {}

  if (!card) return;

  me = store.getMe();
  if (!me) {
    // If onboarding not done, save pending card to session/local and process after onboarding
    localStorage.setItem('hb_pending_scan', JSON.stringify(card));
    return;
  }

  if (card.id === me.id) {
    showToast("That's your own ticket code!");
    return;
  }

  try {
    const loc = await getQuickLocation();
    const result = await store.recordScan({
      card,
      me,
      loc,
      now: new Date().toISOString()
    });
    showScanConfirmation(result.person, result.isNew);
  } catch (err) {
    console.error('Failed to process #add= scan:', err);
  }
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
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  for (const person of people) {
    const li = document.createElement('li');
    li.className = 'card glass person-card';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `View contact ${person.n}`);

    const left = document.createElement('div');
    left.className = 'person-left';

    const avatar = document.createElement('div');
    avatar.className = 'person-avatar';
    avatar.textContent = (person.n || '?').charAt(0).toUpperCase();

    const info = document.createElement('div');
    info.className = 'person-info';

    const name = document.createElement('h3');
    name.className = 'person-name';
    name.textContent = person.n || 'Unnamed';

    const details = document.createElement('p');
    details.className = 'person-details';
    const handles = [];
    if (person.p) handles.push(person.p);
    if (person.ig) handles.push(`@${person.ig}`);
    if (person.sc) handles.push(`sc:${person.sc}`);
    details.textContent = handles.join(' · ') || 'No extra info';

    info.appendChild(name);
    info.appendChild(details);
    left.appendChild(avatar);
    left.appendChild(info);

    const arrow = document.createElement('span');
    arrow.style.color = 'var(--text-muted)';
    arrow.style.fontSize = '18px';
    arrow.innerHTML = '&rsaquo;';

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

// Contact Detail Modal
function openContactModal(person) {
  selectedContact = person;
  const backdrop = document.getElementById('modal-contact-backdrop');
  const nameEl = document.getElementById('contact-modal-name');
  const infoEl = document.getElementById('contact-modal-info');
  const actCall = document.getElementById('cmodal-act-call');
  const actText = document.getElementById('cmodal-act-text');
  const actIg = document.getElementById('cmodal-act-ig');
  const actSc = document.getElementById('cmodal-act-sc');

  if (!backdrop) return;

  if (nameEl) nameEl.textContent = person.n || 'Contact';

  if (infoEl) {
    infoEl.innerHTML = '';
    if (person.p) infoEl.innerHTML += `<div><strong>Phone:</strong> ${person.p}</div>`;
    if (person.ig) infoEl.innerHTML += `<div><strong>Instagram:</strong> @${person.ig}</div>`;
    if (person.sc) infoEl.innerHTML += `<div><strong>Snapchat:</strong> ${person.sc}</div>`;
    if (person.e) infoEl.innerHTML += `<div><strong>Email:</strong> ${person.e}</div>`;
  }

  // Action buttons
  if (actCall) {
    if (person.p) {
      actCall.href = `tel:${person.p}`;
      actCall.style.display = 'flex';
    } else {
      actCall.style.display = 'none';
    }
  }

  if (actText) {
    if (person.p) {
      actText.href = `sms:${person.p}`;
      actText.style.display = 'flex';
    } else {
      actText.style.display = 'none';
    }
  }

  if (actIg) {
    if (person.ig) {
      actIg.href = `https://instagram.com/${person.ig}`;
      actIg.style.display = 'flex';
    } else {
      actIg.style.display = 'none';
    }
  }

  if (actSc) {
    if (person.sc) {
      actSc.href = `https://snapchat.com/add/${person.sc}`;
      actSc.style.display = 'flex';
    } else {
      actSc.style.display = 'none';
    }
  }

  backdrop.classList.add('is-open');
}

function closeContactModal() {
  document.getElementById('modal-contact-backdrop')?.classList.remove('is-open');
  selectedContact = null;
}

function setupContactModal() {
  document.getElementById('btn-close-contact')?.addEventListener('click', closeContactModal);
  document.getElementById('modal-contact-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeContactModal();
  });

  document.getElementById('cmodal-act-vcard')?.addEventListener('click', () => {
    if (selectedContact) downloadVCard(selectedContact);
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
    currentPasscodeAttempt = '';
    updatePasscodeDots();
  } else {
    if (lockedScreen) lockedScreen.style.display = 'none';
    if (unlockedScreen) unlockedScreen.style.display = 'flex';
    renderUnlockedNight();
  }
}

function updatePasscodeDots() {
  const dots = document.querySelectorAll('#passcode-dots .passcode-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('filled', idx < currentPasscodeAttempt.length);
  });
}

function setupPasscodeKeypad() {
  const keypad = document.getElementById('passcode-keypad');
  const errorEl = document.getElementById('passcode-error');

  keypad?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (errorEl) errorEl.textContent = '';

    const digit = btn.dataset.digit;
    if (digit !== undefined) {
      if (currentPasscodeAttempt.length < 8) {
        currentPasscodeAttempt += digit;
        updatePasscodeDots();
      }

      // Check passcode when user reaches 4-8 digits
      if (currentPasscodeAttempt.length >= 4) {
        vaultMeta = store.getVault();
        if (!vaultMeta) return;

        try {
          unlockedKey = await unlock(vaultMeta, currentPasscodeAttempt);
          resetAutoLockTimer();
          renderNight();
        } catch {
          // If at max 8 digits or wrong attempt, show error
          if (currentPasscodeAttempt.length >= 8) {
            if (errorEl) errorEl.textContent = 'Wrong passcode';
            currentPasscodeAttempt = '';
            updatePasscodeDots();
          }
        }
      }
    } else if (btn.id === 'keypad-clear') {
      currentPasscodeAttempt = '';
      updatePasscodeDots();
      if (errorEl) errorEl.textContent = '';
    } else if (btn.id === 'keypad-backspace') {
      if (currentPasscodeAttempt.length > 0) {
        currentPasscodeAttempt = currentPasscodeAttempt.slice(0, -1);
        updatePasscodeDots();
      }
      if (errorEl) errorEl.textContent = '';
    }
  });

  // Lock button in unlocked view
  document.getElementById('btn-lock-night')?.addEventListener('click', () => {
    lockNightLog();
    renderNight();
    showToast('Night log locked');
  });
}

// Render Unlocked Timeline & Morning Recap
async function renderUnlockedNight() {
  if (!unlockedKey) return;
  resetAutoLockTimer();

  const sealedList = store.listSealed();
  const decrypted = [];

  for (const sealed of sealedList) {
    try {
      const entry = await open(unlockedKey, sealed);
      if (entry) decrypted.push(entry);
    } catch {
      // Ignore corrupted or unopenable entry
    }
  }

  // Group noon-to-noon
  const tzOffsetMin = new Date().getTimezoneOffset();
  const nights = groupByNight(decrypted, { tzOffsetMin });

  renderMorningRecap(nights[0]);
  renderNightTimeline(nights, tzOffsetMin);
  setupNightExports(nights, decrypted);
}

function renderMorningRecap(latestNight) {
  const recapCard = document.getElementById('recap-card');
  const headline = document.getElementById('recap-headline');
  const body = document.getElementById('recap-body');
  const dateEl = document.getElementById('recap-date');
  const actionContainer = document.getElementById('recap-action-container');
  const actionBtn = document.getElementById('recap-action-btn');

  if (!recapCard) return;

  if (!latestNight || latestNight.entries.length === 0) {
    if (headline) headline.textContent = 'The morning after';
    if (body) body.textContent = 'No entries recorded yet. Tap Swap to scan contacts or log notes.';
    if (dateEl) dateEl.textContent = '';
    if (actionContainer) actionContainer.style.display = 'none';
    return;
  }

  const info = recap(latestNight);
  if (dateEl) dateEl.textContent = latestNight.label;

  let text = '';
  if (info.people > 0) {
    text = `Last night you were with ${info.people} ${info.people === 1 ? 'person' : 'people'}.`;
    if (info.lastWith) {
      const lastTime = formatTime(info.lastWith.at, latestNight.tzOffsetMin);
      text += ` Last with ${info.lastWith.name} at ${lastTime}.`;
    }
  } else {
    text = 'Your recorded timeline for last night:';
  }

  if (info.wentHome) {
    const homeTime = formatTime(info.wentHome, latestNight.tzOffsetMin);
    text += ` Got home at ${homeTime}.`;
  }

  if (body) body.textContent = text;

  // If last person is known, show text button
  if (info.lastWith && actionContainer && actionBtn) {
    const person = store.getPerson(info.lastWith.personId);
    if (person && person.p) {
      actionBtn.href = `sms:${person.p}`;
      actionBtn.textContent = `Text ${person.n}`;
      actionContainer.style.display = 'block';
    } else {
      actionContainer.style.display = 'none';
    }
  } else if (actionContainer) {
    actionContainer.style.display = 'none';
  }
}

function renderNightTimeline(nights, tzOffsetMin) {
  const container = document.getElementById('night-timeline-container');
  if (!container) return;
  container.innerHTML = '';

  if (nights.length === 0) return;

  for (const night of nights) {
    const group = document.createElement('div');
    group.className = 'night-group';

    const label = document.createElement('h3');
    label.className = 'night-group-label';
    label.textContent = night.label;
    group.appendChild(label);

    const list = document.createElement('div');
    list.className = 'timeline-list';

    for (const entry of night.entries) {
      const item = document.createElement('div');
      item.className = 'timeline-item';

      const dot = document.createElement('div');
      dot.className = 'timeline-dot';
      if (entry.type === 'met') {
        dot.classList.add('timeline-dot-pink');
      } else if (entry.type === 'home') {
        dot.classList.add('timeline-dot-lime');
      } else {
        dot.classList.add('timeline-dot-orange');
      }

      const time = document.createElement('div');
      time.className = 'timeline-time';
      time.textContent = formatTime(entry.at, tzOffsetMin);

      const content = document.createElement('div');
      content.className = 'timeline-content';

      const text = document.createElement('p');
      text.className = 'timeline-text';
      if (entry.type === 'met') {
        text.textContent = entry.again ? `Still with ${entry.name}` : `Met ${entry.name}`;
      } else if (entry.type === 'home') {
        text.textContent = "I'm home";
      } else if (entry.type === 'note') {
        text.textContent = entry.text || 'Note';
      } else {
        text.textContent = entry.text || entry.type;
      }
      content.appendChild(text);

      // Apple Maps link if loc exists
      if (entry.loc && typeof entry.loc.lat === 'number' && typeof entry.loc.lng === 'number') {
        const mapLink = document.createElement('a');
        mapLink.className = 'timeline-map-link';
        mapLink.href = `https://maps.apple.com/?ll=${entry.loc.lat},${entry.loc.lng}`;
        mapLink.target = '_blank';
        mapLink.rel = 'noopener noreferrer';
        mapLink.textContent = 'View on map';
        content.appendChild(mapLink);
      }

      item.appendChild(dot);
      item.appendChild(time);
      item.appendChild(content);
      list.appendChild(item);
    }

    group.appendChild(list);
    container.appendChild(group);
  }
}

function setupNightExports(nights, decryptedEntries) {
  // Share this night
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
          await navigator.share({
            title: `Homebound - ${nights[0].label}`,
            text
          });
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

  // Download decrypted log
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
// Settings Modal
// ============================================================================
function openSettingsModal() {
  const backdrop = document.getElementById('modal-settings-backdrop');
  if (!backdrop) return;

  me = store.getMe();
  const settings = store.getSettings();

  // Populate edit card inputs
  const editName = document.getElementById('edit-card-name');
  const editPhone = document.getElementById('edit-card-phone');
  const editIg = document.getElementById('edit-card-ig');
  const editSc = document.getElementById('edit-card-sc');
  const editEmail = document.getElementById('edit-card-email');

  if (editName && me) editName.value = me.n || '';
  if (editPhone && me) editPhone.value = me.p || '';
  if (editIg && me) editIg.value = me.ig || '';
  if (editSc && me) editSc.value = me.sc || '';
  if (editEmail && me) editEmail.value = me.e || '';

  // Populate settings toggles
  const locToggle = document.getElementById('settings-location-toggle');
  if (locToggle) locToggle.checked = Boolean(settings.location);

  const autolockSel = document.getElementById('settings-autolock-select');
  if (autolockSel) autolockSel.value = String(settings.autoLockMin || 5);

  backdrop.classList.add('is-open');
}

function closeSettingsModal() {
  document.getElementById('modal-settings-backdrop')?.classList.remove('is-open');
}

function setupSettingsModal() {
  document.getElementById('btn-settings-open')?.addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSettingsModal);
  document.getElementById('modal-settings-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettingsModal();
  });

  // Edit card form
  document.getElementById('form-edit-card')?.addEventListener('submit', (e) => {
    e.preventDefault();
    me = store.getMe() || { id: newId() };

    const name = document.getElementById('edit-card-name')?.value.trim();
    if (!name) return;

    me.n = name;
    const phone = document.getElementById('edit-card-phone')?.value.trim();
    const ig = document.getElementById('edit-card-ig')?.value.trim().replace(/^@/, '');
    const sc = document.getElementById('edit-card-sc')?.value.trim().replace(/^@/, '');
    const email = document.getElementById('edit-card-email')?.value.trim();

    if (phone) me.p = phone; else delete me.p;
    if (ig) me.ig = ig; else delete me.ig;
    if (sc) me.sc = sc; else delete me.sc;
    if (email) me.e = email; else delete me.e;

    store.setMe(me);
    renderSwap();
    showToast('Card updated');
    closeSettingsModal();
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

  // Change Passcode form
  document.getElementById('form-change-passcode')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPass = document.getElementById('change-old-pass')?.value;
    const newPass = document.getElementById('change-new-pass')?.value;
    const errorEl = document.getElementById('change-pass-error');

    if (errorEl) errorEl.textContent = '';
    vaultMeta = store.getVault();
    if (!vaultMeta) return;

    try {
      const updatedMeta = await changePasscode(vaultMeta, oldPass, newPass);
      store.setVault(updatedMeta);
      vaultMeta = updatedMeta;
      document.getElementById('change-old-pass').value = '';
      document.getElementById('change-new-pass').value = '';
      showToast('Passcode updated successfully');
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message === 'bad_passcode' ? 'Current passcode is incorrect.' : 'Invalid passcode format.';
      }
    }
  });

  // Delete everything (Confirm)
  document.getElementById('btn-delete-everything')?.addEventListener('click', () => {
    const sure = confirm(
      'Are you absolutely sure?\n\nThis will permanently delete all your contacts, sealed night logs, and encryption keys from this device.'
    );
    if (!sure) return;

    store.wipe();
    lockNightLog();
    closeSettingsModal();
    checkOnboarding();
    showToast('All data erased');
  });
}

// ============================================================================
// Onboarding Flow
// ============================================================================
let onboardCardData = null;

function checkOnboarding() {
  me = store.getMe();
  vaultMeta = store.getVault();

  const backdrop = document.getElementById('modal-onboarding-backdrop');
  if (!me || !vaultMeta) {
    if (backdrop) backdrop.style.display = 'flex';
    showOnboardingStep(1);
  } else {
    if (backdrop) backdrop.style.display = 'none';
    renderSwap();
  }
}

function showOnboardingStep(step) {
  document.getElementById('onboarding-step-1').style.display = step === 1 ? 'block' : 'none';
  document.getElementById('onboarding-step-2').style.display = step === 2 ? 'block' : 'none';
}

function setupOnboarding() {
  const formCard = document.getElementById('form-onboard-card');
  const formPasscode = document.getElementById('form-onboard-passcode');
  const backBtn = document.getElementById('btn-onboard-back');
  const errorEl = document.getElementById('onboard-pass-error');

  // Step 1: Your Card
  formCard?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('onboard-name')?.value.trim();
    if (!name) return;

    const phone = document.getElementById('onboard-phone')?.value.trim();
    const ig = document.getElementById('onboard-ig')?.value.trim().replace(/^@/, '');
    const sc = document.getElementById('onboard-sc')?.value.trim().replace(/^@/, '');
    const email = document.getElementById('onboard-email')?.value.trim();

    onboardCardData = {
      v: 1,
      id: newId(),
      n: name
    };
    if (phone) onboardCardData.p = phone;
    if (ig) onboardCardData.ig = ig;
    if (sc) onboardCardData.sc = sc;
    if (email) onboardCardData.e = email;

    showOnboardingStep(2);
  });

  backBtn?.addEventListener('click', () => showOnboardingStep(1));

  // Step 2: Passcode
  formPasscode?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = document.getElementById('onboard-pass')?.value;
    const confirmPass = document.getElementById('onboard-pass-confirm')?.value;

    if (errorEl) errorEl.textContent = '';

    if (pass !== confirmPass) {
      if (errorEl) errorEl.textContent = 'Passcodes do not match.';
      return;
    }

    if (!pass || pass.length < 4 || pass.length > 8 || !/^[0-9]+$/.test(pass)) {
      if (errorEl) errorEl.textContent = 'Passcode must be 4 to 8 digits.';
      return;
    }

    try {
      const meta = await createVault(pass);
      store.setMe(onboardCardData);
      store.setVault(meta);

      document.getElementById('modal-onboarding-backdrop').style.display = 'none';
      renderSwap();
      showToast('Welcome to Homebound!');

      // If there was a pending scan from #add= before onboarding
      const pendingRaw = localStorage.getItem('hb_pending_scan');
      if (pendingRaw) {
        localStorage.removeItem('hb_pending_scan');
        try {
          const pendingCard = JSON.parse(pendingRaw);
          const result = await store.recordScan({
            card: pendingCard,
            me: onboardCardData,
            now: new Date().toISOString()
          });
          showScanConfirmation(result.person, result.isNew);
        } catch {}
      }
    } catch (err) {
      console.error('Onboarding vault creation error:', err);
      if (errorEl) errorEl.textContent = 'Failed to create encryption vault.';
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  setupIosPrompt();
  setupQuickMenu();
  setupNoteModal();
  setupScanners();
  setupContactModal();
  setupPasscodeKeypad();
  setupSettingsModal();
  setupOnboarding();

  // Tab navigation listeners
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.view);
    });
  });

  // Check onboarding status
  checkOnboarding();

  // Process initial URL fragment if any
  handleUrlAddFragment();
  window.addEventListener('hashchange', handleUrlAddFragment);
});
