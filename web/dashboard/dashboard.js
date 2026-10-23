// web/dashboard/dashboard.js - Left-Aligned Live Monitor & Organizer Dashboard
import * as api from '../shared/api.js';

// DOM Elements
const eventTitle = document.getElementById('event-title');
const liveBadge = document.getElementById('live-badge');
const liveText = document.getElementById('live-text');
const btnLogout = document.getElementById('btn-logout');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnClosingMode = document.getElementById('btn-closing-mode');

// Main Views
const liveDashboardView = document.getElementById('live-dashboard-view');
const closingTimeView = document.getElementById('closing-time-view');
const btnExitClosing = document.getElementById('btn-exit-closing');
const btnPrintClosing = document.getElementById('btn-print-closing');
const closingInsideCount = document.getElementById('closing-inside-count');
const closingChecklistContainer = document.getElementById('closing-checklist-container');
const printEventTitle = document.getElementById('print-event-title');
const printChecklistMeta = document.getElementById('print-checklist-meta');

// Capacity Elements
const capacityBadge = document.getElementById('capacity-badge');
const capacityCounter = document.getElementById('capacity-counter');
const capacityFill = document.getElementById('capacity-fill');
const capacityWarningText = document.getElementById('capacity-warning-text');
const btnSetCapacity = document.getElementById('btn-set-capacity');
const capacityModal = document.getElementById('capacity-modal');
const capacityForm = document.getElementById('capacity-form');
const inputCapacity = document.getElementById('input-capacity');
const btnCancelCapacity = document.getElementById('btn-cancel-capacity');

// Stats Elements
const statInside = document.getElementById('stat-inside');
const statCheckedIn = document.getElementById('stat-checked-in');
const statLeft = document.getElementById('stat-left');

// Departures & Roster
const departuresList = document.getElementById('departures-list');
const departuresEmpty = document.getElementById('departures-empty');
const rosterSearch = document.getElementById('roster-search');
const rosterList = document.getElementById('roster-list');
const filterPills = document.querySelectorAll('.filter-pill');

const countAll = document.getElementById('count-all');
const countInside = document.getElementById('count-inside');
const countLeft = document.getElementById('count-left');
const countNotArrived = document.getElementById('count-not-arrived');

// Login Modal
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const loginEventId = document.getElementById('login-event-id');
const loginCode = document.getElementById('login-code');
const loginName = document.getElementById('login-name');
const loginError = document.getElementById('login-error');

// State
let dashboardData = {
  event: null,
  inside: 0,
  checkedIn: 0,
  left: 0,
  roster: [],
  recentDepartures: [],
};
let activeFilter = 'all';
let searchQuery = '';
let streamSource = null;
let isClosingMode = false;
let checkedGuests = new Set();
let isMuted = localStorage.getItem('hb_muted') === 'true';
let currentCapacity = null;
let reconnectTimeout = null;
let reconnectDelay = 1000;

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// --- Sound & Vibration Alerts ---
function updateSoundButtonUI() {
  if (btnToggleSound) {
    btnToggleSound.textContent = isMuted ? 'Muted' : 'Sound';
    btnToggleSound.title = isMuted ? 'Alerts muted (click to enable)' : 'Alerts active (click to mute)';
  }
}

btnToggleSound?.addEventListener('click', () => {
  isMuted = !isMuted;
  localStorage.setItem('hb_muted', String(isMuted));
  updateSoundButtonUI();
});

function playDepartureAlert() {
  if (isMuted) return;

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, now + 0.12);
      gain2.gain.setValueAtTime(0.18, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.4);
    }
  } catch {}

  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([120, 60, 120]);
    } catch {}
  }
}

// --- Capacity Limit Management ---
function getActiveEventId() {
  return dashboardData.event?.id ||
    api.getMonitorSession()?.eventId ||
    api.getAdminSession()?.eventId ||
    loginEventId?.value.trim() ||
    null;
}

function updateCapacityUI() {
  const eventId = getActiveEventId();
  currentCapacity = dashboardData.event?.capacity || api.getEventCapacity(eventId);
  const inside = dashboardData.inside ?? 0;

  if (!currentCapacity || currentCapacity <= 0) {
    if (capacityCounter) capacityCounter.textContent = `${inside} inside`;
    if (capacityFill) {
      capacityFill.style.width = '0%';
      capacityFill.className = 'capacity-fill';
    }
    if (capacityWarningText) capacityWarningText.className = 'capacity-warning hidden';
    return;
  }

  const pct = Math.round((inside / currentCapacity) * 100);
  const fillPct = Math.min(Math.max(pct, 0), 100);

  if (capacityFill) {
    capacityFill.style.width = `${fillPct}%`;
  }
  if (capacityCounter) {
    capacityCounter.textContent = `${inside} / ${currentCapacity} (${pct}%)`;
  }

  if (pct >= 100) {
    if (capacityFill) capacityFill.className = 'capacity-fill capacity-red';
    if (capacityWarningText) {
      capacityWarningText.className = 'capacity-warning warning-red';
      capacityWarningText.textContent = `At capacity (${inside} of ${currentCapacity}). Restrict further admissions.`;
    }
  } else if (pct >= 90) {
    if (capacityFill) capacityFill.className = 'capacity-fill capacity-amber';
    if (capacityWarningText) {
      capacityWarningText.className = 'capacity-warning warning-amber';
      capacityWarningText.textContent = `Approaching capacity (${inside} of ${currentCapacity} · ${currentCapacity - inside} spots left).`;
    }
  } else {
    if (capacityFill) capacityFill.className = 'capacity-fill';
    if (capacityWarningText) capacityWarningText.className = 'capacity-warning hidden';
  }
}

btnSetCapacity?.addEventListener('click', () => {
  const eventId = getActiveEventId();
  const cap = api.getEventCapacity(eventId);
  inputCapacity.value = cap || '';
  capacityModal.classList.add('open');
});

btnCancelCapacity?.addEventListener('click', () => {
  capacityModal.classList.remove('open');
});

capacityForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventId = getActiveEventId();
  const val = inputCapacity.value.trim();
  const num = val ? parseInt(val, 10) : null;

  api.saveEventCapacity(eventId, val);

  if (api.getAdminPin()) {
    try {
      if (num && num > 0) {
        await api.updateEvent(eventId, { capacity: num });
      }
    } catch {}
  }

  if (dashboardData.event) {
    dashboardData.event.capacity = num;
  }
  capacityModal.classList.remove('open');
  updateCapacityUI();
});

// --- Closing Time Mode ---
function toggleClosingMode(enable) {
  isClosingMode = enable;
  if (isClosingMode) {
    liveDashboardView.classList.add('hidden');
    closingTimeView.classList.remove('hidden');
    btnClosingMode.classList.add('btn-primary');
    btnClosingMode.classList.remove('btn-secondary');
    renderClosingChecklist();
  } else {
    closingTimeView.classList.add('hidden');
    liveDashboardView.classList.remove('hidden');
    btnClosingMode.classList.remove('btn-primary');
    btnClosingMode.classList.add('btn-secondary');
  }
}

btnClosingMode?.addEventListener('click', () => {
  toggleClosingMode(!isClosingMode);
});

btnExitClosing?.addEventListener('click', () => {
  toggleClosingMode(false);
});

btnPrintClosing?.addEventListener('click', () => {
  window.print();
});

function renderClosingChecklist() {
  const roster = dashboardData.roster || [];
  const insideGuests = roster.filter(r => r.status === 'inside');

  if (closingInsideCount) {
    closingInsideCount.textContent = insideGuests.length;
  }
  if (printEventTitle) {
    printEventTitle.textContent = `${dashboardData.event?.name || 'Homebound'} — Closing Checklist`;
  }
  if (printChecklistMeta) {
    printChecklistMeta.textContent = `Generated ${new Date().toLocaleString()} · ${insideGuests.length} Guests Still Inside`;
  }

  if (!closingChecklistContainer) return;
  closingChecklistContainer.innerHTML = '';

  if (insideGuests.length === 0) {
    closingChecklistContainer.innerHTML = `
      <div class="card text-center text-muted" style="padding: 2.5rem 1.5rem; width: 100%;">
        <h3>Venue is cleared</h3>
        <p style="font-size: var(--text-14); margin-top: 0.5rem;">Zero guests are recorded inside. All wristbands have exited.</p>
      </div>
    `;
    return;
  }

  const sorted = [...insideGuests].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach(guest => {
    const isChecked = checkedGuests.has(guest.name);
    const item = document.createElement('div');
    item.className = `closing-item ${isChecked ? 'checked' : ''}`;
    item.dataset.guestName = guest.name;

    item.innerHTML = `
      <div class="closing-checkbox">${isChecked ? '✓' : ''}</div>
      <div style="display: flex; flex-direction: column; gap: 0.2rem; min-width: 0;">
        <span style="font-weight: 700; font-size: var(--text-16);">${escapeHtml(guest.name)}</span>
        <div style="font-size: var(--text-14); color: var(--slate); display: flex; gap: 0.5rem; align-items: center;">
          ${guest.band ? `<span class="wristband-chip band-orange" style="font-size: 12px; padding: 2px 10px 2px 8px;">${escapeHtml(guest.band)}</span>` : ''}
          <span>In at ${api.formatTime(guest.inAt)}</span>
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      if (checkedGuests.has(guest.name)) {
        checkedGuests.delete(guest.name);
      } else {
        checkedGuests.add(guest.name);
      }
      renderClosingChecklist();
    });

    closingChecklistContainer.appendChild(item);
  });
}

// --- Auth & Session ---
async function init() {
  updateSoundButtonUI();

  const urlParams = new URLSearchParams(window.location.search);
  const urlEvent = urlParams.get('event') || urlParams.get('eventId');
  if (urlEvent && loginEventId) loginEventId.value = urlEvent;

  const session = api.getMonitorSession();
  const adminSession = api.getAdminSession();

  if (session && session.token) {
    loginModal.classList.remove('open');
    await loadDashboard();
    connectSse();
  } else if (adminSession && adminSession.pin) {
    loginModal.classList.remove('open');
    await loadDashboard();
  } else {
    loginModal.classList.add('open');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const eventId = loginEventId.value.trim();
  const monitorCode = loginCode.value.trim().toUpperCase();
  const name = loginName.value.trim();

  try {
    await api.joinMonitor(eventId, { monitorCode, name });
    loginModal.classList.remove('open');
    await loadDashboard();
    connectSse();
  } catch (err) {
    loginError.textContent = err.message || 'Invalid monitor code';
    loginError.classList.remove('hidden');
  }
});

btnLogout.addEventListener('click', () => {
  if (confirm('Exit dashboard?')) {
    api.clearMonitorSession();
    window.location.reload();
  }
});

// --- Data Fetching & Rendering ---
async function loadDashboard() {
  try {
    const data = await api.getDashboard();
    dashboardData = data;
    renderAll();
  } catch (err) {
    console.error('Failed to load dashboard:', err);
    if (err.status === 401 || err.status === 403) {
      loginModal.classList.add('open');
    }
  }
}

function renderAll() {
  if (dashboardData.event) {
    eventTitle.textContent = dashboardData.event.name || 'Live Dashboard';
    document.title = `${dashboardData.event.name || 'Live'} - Homebound`;
  }

  statInside.textContent = dashboardData.inside ?? 0;
  statCheckedIn.textContent = dashboardData.checkedIn ?? 0;
  statLeft.textContent = dashboardData.left ?? 0;

  updateCapacityUI();
  renderDepartures();
  renderRoster();

  if (isClosingMode) {
    renderClosingChecklist();
  }
}

// Departures as grouped pink band chips
function renderDepartures() {
  departuresList.innerHTML = '';
  const deps = dashboardData.recentDepartures || [];

  if (deps.length === 0) {
    departuresList.appendChild(departuresEmpty);
    return;
  }

  deps.forEach(dep => {
    const chip = document.createElement('div');
    chip.className = 'wristband-banner';
    chip.style.backgroundColor = 'var(--band-pink)';
    chip.style.color = '#1B2340';
    chip.style.marginBottom = '0.65rem';

    const peopleList = Array.isArray(dep.people) ? dep.people : [];
    const names = peopleList.join(', ') || 'Guest';
    const isGroup = peopleList.length > 1;
    const timeStr = api.formatTime(dep.at);

    chip.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; padding-right: 14px;">
        <span style="font-family: var(--font-display); font-size: var(--text-16); font-weight: 700; word-break: break-word;">${escapeHtml(names)}</span>
        <span style="font-family: var(--font-sans); font-size: var(--text-14); font-weight: 500; opacity: 0.85;">
          ${isGroup ? 'left together' : 'left'} · ${timeStr}
        </span>
      </div>
    `;
    departuresList.appendChild(chip);
  });
}

// Searchable roster as rows of band chips
function renderRoster() {
  const roster = dashboardData.roster || [];

  const total = roster.length;
  const inside = roster.filter(r => r.status === 'inside').length;
  const left = roster.filter(r => r.status === 'left').length;
  const notArrived = roster.filter(r => r.status === 'not_arrived').length;

  countAll.textContent = total;
  countInside.textContent = inside;
  countLeft.textContent = left;
  countNotArrived.textContent = notArrived;

  const q = searchQuery.toLowerCase().trim();
  const filtered = roster.filter(item => {
    if (activeFilter !== 'all' && item.status !== activeFilter) {
      return false;
    }
    if (q) {
      const matchName = item.name.toLowerCase().includes(q);
      const matchBand = item.band && item.band.toLowerCase().includes(q);
      return matchName || matchBand;
    }
    return true;
  });

  if (!rosterList) return;
  rosterList.innerHTML = '';

  if (filtered.length === 0) {
    rosterList.innerHTML = '<p class="text-muted" style="padding: 1.5rem 0; font-size: var(--text-14);">No guests match this filter</p>';
    return;
  }

  filtered.forEach(guest => {
    const row = document.createElement('div');
    row.className = 'roster-item';

    let chipHtml = '';
    if (guest.status === 'inside') {
      const timeStr = guest.inAt ? ` · ${api.formatTime(guest.inAt)}` : '';
      chipHtml = `<span class="wristband-chip band-orange">Inside${timeStr}</span>`;
    } else if (guest.status === 'left') {
      const companions = Array.isArray(guest.leftWith) && guest.leftWith.length > 0
        ? ` with ${escapeHtml(guest.leftWith.join(', '))}`
        : '';
      const timeStr = guest.outAt ? ` · ${api.formatTime(guest.outAt)}` : '';
      chipHtml = `<span class="wristband-chip band-pink">Left${companions}${timeStr}</span>`;
    } else {
      chipHtml = `<span class="wristband-chip band-outline">Not arrived</span>`;
    }

    row.innerHTML = `
      <div class="roster-guest-info">
        <span class="roster-guest-name">${escapeHtml(guest.name)}</span>
        ${guest.band ? `<span class="roster-guest-meta">Band [${escapeHtml(guest.band)}]</span>` : ''}
      </div>
      <div>
        ${chipHtml}
      </div>
    `;
    rosterList.appendChild(row);
  });
}

// Filter pills
filterPills.forEach(pill => {
  pill.addEventListener('click', () => {
    filterPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    renderRoster();
  });
});

rosterSearch.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderRoster();
});

// --- SSE Real-time Updates & Auto-Reconnect ---
function updateLiveStatus(state) {
  if (state === 'live') {
    liveBadge.className = 'live-indicator';
    liveText.textContent = 'Live';
    reconnectDelay = 1000;
  } else if (state === 'reconnecting') {
    liveBadge.className = 'live-indicator reconnecting';
    liveText.textContent = 'Reconnecting...';
  } else {
    liveBadge.className = 'live-indicator offline';
    liveText.textContent = 'Offline';
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  updateLiveStatus('reconnecting');

  reconnectTimeout = setTimeout(async () => {
    reconnectTimeout = null;
    reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
    try {
      await loadDashboard();
      connectSse();
    } catch {
      scheduleReconnect();
    }
  }, reconnectDelay);
}

function connectSse() {
  if (streamSource) {
    try { streamSource.close(); } catch {}
    streamSource = null;
  }

  try {
    streamSource = api.openDashboardStream({
      onOpen: () => {
        updateLiveStatus('live');
      },
      onStats: (stats) => {
        dashboardData.inside = stats.inside ?? dashboardData.inside;
        dashboardData.checkedIn = stats.checkedIn ?? dashboardData.checkedIn;
        dashboardData.left = stats.left ?? dashboardData.left;
        statInside.textContent = dashboardData.inside;
        statCheckedIn.textContent = dashboardData.checkedIn;
        statLeft.textContent = dashboardData.left;
        updateCapacityUI();
      },
      onScan: (scan) => {
        const guestName = scan.guest?.name || scan.guestName || 'Guest';
        const bandKey = scan.shortCode || scan.bandToken;

        let guestEntry = (dashboardData.roster || []).find(r =>
          (scan.guestId && r.id === scan.guestId) ||
          r.name.toLowerCase() === guestName.toLowerCase() ||
          (bandKey && r.band === bandKey)
        );

        if (guestEntry) {
          guestEntry.status = scan.direction === 'in' ? 'inside' : 'left';
          if (scan.direction === 'in') {
            guestEntry.inAt = scan.at || new Date().toISOString();
          } else {
            guestEntry.outAt = scan.at || new Date().toISOString();
          }
          if (bandKey && !guestEntry.band) guestEntry.band = bandKey;
        } else {
          dashboardData.roster = dashboardData.roster || [];
          dashboardData.roster.unshift({
            name: guestName,
            band: bandKey,
            status: scan.direction === 'in' ? 'inside' : 'left',
            inAt: scan.direction === 'in' ? (scan.at || new Date().toISOString()) : null,
            outAt: scan.direction === 'out' ? (scan.at || new Date().toISOString()) : null,
          });
        }
        renderRoster();
        if (isClosingMode) renderClosingChecklist();
      },
      onDeparture: (dep) => {
        dashboardData.recentDepartures = dashboardData.recentDepartures || [];
        dashboardData.recentDepartures.unshift(dep);
        if (dashboardData.recentDepartures.length > 50) {
          dashboardData.recentDepartures.pop();
        }

        const people = Array.isArray(dep.people) ? dep.people : [];
        people.forEach(name => {
          const entry = (dashboardData.roster || []).find(r => r.name.toLowerCase() === name.toLowerCase());
          if (entry) {
            entry.status = 'left';
            entry.outAt = dep.at || new Date().toISOString();
            if (people.length > 1) {
              entry.leftWith = people.filter(p => p.toLowerCase() !== name.toLowerCase());
            }
          }
        });

        playDepartureAlert();
        renderDepartures();
        renderRoster();
        if (isClosingMode) renderClosingChecklist();
      },
      onError: () => {
        scheduleReconnect();
      },
    });
  } catch {
    scheduleReconnect();
  }
}

init();
