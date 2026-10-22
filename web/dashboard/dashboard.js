// web/dashboard/dashboard.js - Live Monitor & Organizer Dashboard
import * as api from '/shared/api.js';

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
const rosterTbody = document.getElementById('roster-tbody');
const filterTabs = document.querySelectorAll('.filter-tab');

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

// --- Sound & Vibration Alerts ---

function updateSoundButtonUI() {
  if (btnToggleSound) {
    btnToggleSound.textContent = isMuted ? '🔕 Muted' : '🔔 Sound';
    btnToggleSound.title = isMuted ? 'Sound and vibration alerts muted (click to enable)' : 'Sound and vibration alerts active (click to mute)';
  }
}

btnToggleSound?.addEventListener('click', () => {
  isMuted = !isMuted;
  localStorage.setItem('hb_muted', String(isMuted));
  updateSoundButtonUI();
});

function playDepartureAlert() {
  if (isMuted) return;

  // Web Audio 2-tone melodic chime
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Tone 1: E5 (659 Hz)
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

      // Tone 2: B5 (987 Hz)
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
  } catch (err) {
    // Handled if browser restricts audio autoplay before user interaction
  }

  // Device vibration
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
    if (capacityBadge) {
      capacityBadge.className = 'badge badge-muted';
      capacityBadge.textContent = 'No limit set';
    }
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
    if (capacityBadge) {
      capacityBadge.className = 'badge badge-red';
      capacityBadge.textContent = `🚨 AT CAPACITY (${pct}%)`;
    }
    if (capacityWarningText) {
      capacityWarningText.className = 'capacity-warning warning-red';
      capacityWarningText.textContent = `⚠️ Venue is at or above capacity (${inside} of ${currentCapacity}). Restrict further admissions.`;
    }
  } else if (pct >= 90) {
    if (capacityFill) capacityFill.className = 'capacity-fill capacity-amber';
    if (capacityBadge) {
      capacityBadge.className = 'badge badge-amber';
      capacityBadge.textContent = `⚠️ NEAR CAPACITY (${pct}%)`;
    }
    if (capacityWarningText) {
      capacityWarningText.className = 'capacity-warning warning-amber';
      capacityWarningText.textContent = `⚠️ Approaching venue capacity (${inside} of ${currentCapacity} guests · ${currentCapacity - inside} spots remaining).`;
    }
  } else {
    if (capacityFill) capacityFill.className = 'capacity-fill';
    if (capacityBadge) {
      capacityBadge.className = 'badge badge-green';
      const remaining = currentCapacity - inside;
      capacityBadge.textContent = `${remaining} spots available`;
    }
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
      <div class="card text-center text-muted" style="padding: 3rem 1.5rem;">
        <span style="font-size: 3rem;">🎉</span>
        <h3 style="margin-top: 0.5rem; color: var(--text);">Venue Is Completely Cleared!</h3>
        <p style="font-size: 1rem; margin-top: 0.5rem;">Zero guests are recorded inside. All wristbands have exited.</p>
      </div>
    `;
    return;
  }

  // Alphabetical sort for security sweep
  const sorted = [...insideGuests].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach(guest => {
    const isChecked = checkedGuests.has(guest.name);
    const item = document.createElement('div');
    item.className = `closing-item ${isChecked ? 'checked' : ''}`;
    item.dataset.guestName = guest.name;

    item.innerHTML = `
      <div class="closing-checkbox">${isChecked ? '✓' : ''}</div>
      <div class="closing-item-info">
        <span class="closing-guest-name">${guest.name}</span>
        <div class="closing-meta">
          ${guest.band ? `<span class="band-chip">${guest.band}</span>` : '<span class="text-dim">—</span>'}
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
    eventTitle.textContent = dashboardData.event.name || 'Event Dashboard';
    document.title = `${dashboardData.event.name || 'Live'} - Homebound Dashboard`;
  }

  // Stats Counters
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

function renderDepartures() {
  departuresList.innerHTML = '';
  const deps = dashboardData.recentDepartures || [];

  if (deps.length === 0) {
    departuresList.appendChild(departuresEmpty);
    return;
  }

  deps.forEach(dep => {
    const div = document.createElement('div');
    div.className = 'departure-item';
    const names = Array.isArray(dep.people) ? dep.people.join(' + ') : 'Guest';
    const isGroup = Array.isArray(dep.people) && dep.people.length > 1;

    div.innerHTML = `
      <div class="departure-names">${names}</div>
      <div class="departure-meta">
        <span>${api.formatTime(dep.at)}</span>
        <span class="badge ${isGroup ? 'badge-amber' : 'badge-muted'}" style="font-size: 0.75rem;">
          ${isGroup ? `${dep.people.length} together` : 'alone'}
        </span>
      </div>
    `;
    departuresList.appendChild(div);
  });
}

function renderRoster() {
  const roster = dashboardData.roster || [];

  // Update tab counts
  const total = roster.length;
  const inside = roster.filter(r => r.status === 'inside').length;
  const left = roster.filter(r => r.status === 'left').length;
  const notArrived = roster.filter(r => r.status === 'not_arrived').length;

  countAll.textContent = total;
  countInside.textContent = inside;
  countLeft.textContent = left;
  countNotArrived.textContent = notArrived;

  // Filter roster
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

  rosterTbody.innerHTML = '';
  if (filtered.length === 0) {
    rosterTbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted" style="padding: 2rem;">
          No guests match this filter
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(guest => {
    const tr = document.createElement('tr');

    let badgeClass = 'badge-muted';
    let statusLabel = 'Not Arrived';
    if (guest.status === 'inside') {
      badgeClass = 'badge-green';
      statusLabel = 'Inside';
    } else if (guest.status === 'left') {
      badgeClass = 'badge-amber';
      statusLabel = 'Left';
    }

    const mates = Array.isArray(guest.leftWith) && guest.leftWith.length > 0
      ? guest.leftWith.join(', ')
      : '—';

    tr.innerHTML = `
      <td style="font-weight: 700;">${guest.name}</td>
      <td>${guest.band ? `<span class="band-chip">${guest.band}</span>` : '<span class="text-dim">—</span>'}</td>
      <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
      <td class="text-muted">${api.formatTime(guest.inAt)}</td>
      <td class="text-muted">${api.formatTime(guest.outAt)}</td>
      <td><span class="group-mates-tag">${mates}</span></td>
    `;
    rosterTbody.appendChild(tr);
  });
}

// Filter tab handlers
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeFilter = tab.dataset.filter;
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
    try {
      await loadDashboard();
      connectSse();
      reconnectDelay = Math.min(reconnectDelay * 1.5, 8000);
    } catch {
      scheduleReconnect();
    }
  }, reconnectDelay);
}

function connectSse() {
  if (streamSource) {
    streamSource.close();
    streamSource = null;
  }

  try {
    streamSource = api.openDashboardStream({
      onOpen: () => {
        updateLiveStatus('live');
      },
      onStats: (stats) => {
        updateLiveStatus('live');
        dashboardData.inside = stats.inside;
        dashboardData.checkedIn = stats.checkedIn;
        dashboardData.left = stats.left;
        statInside.textContent = stats.inside;
        statCheckedIn.textContent = stats.checkedIn;
        statLeft.textContent = stats.left;
        updateCapacityUI();
        if (isClosingMode) renderClosingChecklist();
      },
      onScan: (scan) => {
        updateLiveStatus('live');
        const guestName = scan.guest?.name;
        if (guestName) {
          const item = dashboardData.roster.find(r => r.name === guestName);
          if (item) {
            item.status = scan.direction === 'in' ? 'inside' : 'left';
            if (scan.direction === 'in') item.inAt = scan.at;
            else item.outAt = scan.at;
            if (scan.band) item.band = scan.band;
            renderRoster();
            if (isClosingMode) renderClosingChecklist();
          } else {
            loadDashboard();
          }
        }
      },
      onDeparture: (dep) => {
        updateLiveStatus('live');
        playDepartureAlert();

        const names = Array.isArray(dep.people) ? dep.people.map(p => p.name || p) : [];
        if (!dashboardData.recentDepartures) dashboardData.recentDepartures = [];
        dashboardData.recentDepartures.unshift({
          at: dep.at,
          people: names,
        });
        if (dashboardData.recentDepartures.length > 20) {
          dashboardData.recentDepartures.pop();
        }
        renderDepartures();

        names.forEach(name => {
          const item = dashboardData.roster.find(r => r.name === name);
          if (item) {
            item.status = 'left';
            item.outAt = dep.at;
            item.leftWith = names.filter(n => n !== name);
          }
        });
        renderRoster();
        if (isClosingMode) renderClosingChecklist();
      },
      onError: () => {
        if (streamSource) {
          streamSource.close();
          streamSource = null;
        }
        scheduleReconnect();
      },
    });
  } catch (err) {
    scheduleReconnect();
  }
}

// Initialize
init();
