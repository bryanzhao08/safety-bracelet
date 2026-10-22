// web/dashboard/dashboard.js - Live Monitor & Organizer Dashboard
import * as api from '/shared/api.js';

// DOM Elements
const eventTitle = document.getElementById('event-title');
const liveBadge = document.getElementById('live-badge');
const liveText = document.getElementById('live-text');
const btnLogout = document.getElementById('btn-logout');

const statInside = document.getElementById('stat-inside');
const statCheckedIn = document.getElementById('stat-checked-in');
const statLeft = document.getElementById('stat-left');

const departuresList = document.getElementById('departures-list');
const departuresEmpty = document.getElementById('departures-empty');

const rosterSearch = document.getElementById('roster-search');
const rosterTbody = document.getElementById('roster-tbody');
const filterTabs = document.querySelectorAll('.filter-tab');

const countAll = document.getElementById('count-all');
const countInside = document.getElementById('count-inside');
const countLeft = document.getElementById('count-left');
const countNotArrived = document.getElementById('count-not-arrived');

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

// --- Auth & Session ---

async function init() {
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
    // Admin can also view dashboard if session works
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

  renderDepartures();
  renderRoster();
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
    // Status filter
    if (activeFilter !== 'all' && item.status !== activeFilter) {
      return false;
    }
    // Search query
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

// --- SSE Real-time Updates ---

function connectSse() {
  if (streamSource) {
    streamSource.close();
  }

  try {
    streamSource = api.openDashboardStream({
      onStats: (stats) => {
        liveBadge.className = 'live-indicator';
        liveText.textContent = 'Live';
        dashboardData.inside = stats.inside;
        dashboardData.checkedIn = stats.checkedIn;
        dashboardData.left = stats.left;
        statInside.textContent = stats.inside;
        statCheckedIn.textContent = stats.checkedIn;
        statLeft.textContent = stats.left;
      },
      onScan: (scan) => {
        // Fast update roster item
        const guestName = scan.guest?.name;
        if (guestName) {
          const item = dashboardData.roster.find(r => r.name === guestName);
          if (item) {
            item.status = scan.direction === 'in' ? 'inside' : 'left';
            if (scan.direction === 'in') item.inAt = scan.at;
            else item.outAt = scan.at;
            if (scan.band) item.band = scan.band;
            renderRoster();
          } else {
            // New guest or walk-in, reload full roster
            loadDashboard();
          }
        }
      },
      onDeparture: (dep) => {
        const names = Array.isArray(dep.people) ? dep.people.map(p => p.name || p) : [];
        // Prepend to recent departures
        if (!dashboardData.recentDepartures) dashboardData.recentDepartures = [];
        dashboardData.recentDepartures.unshift({
          at: dep.at,
          people: names,
        });
        if (dashboardData.recentDepartures.length > 20) {
          dashboardData.recentDepartures.pop();
        }
        renderDepartures();

        // Update roster members
        names.forEach(name => {
          const item = dashboardData.roster.find(r => r.name === name);
          if (item) {
            item.status = 'left';
            item.outAt = dep.at;
            item.leftWith = names.filter(n => n !== name);
          }
        });
        renderRoster();
      },
      onError: () => {
        liveBadge.className = 'live-indicator offline';
        liveText.textContent = 'Reconnecting...';
      },
    });
  } catch (err) {
    liveBadge.className = 'live-indicator offline';
    liveText.textContent = 'Offline';
  }
}

// Initialize
init();
