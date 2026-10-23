// web/admin/demo-banner.js - Slim glass banner for sample event mode
import * as api from '../shared/api.js';
import * as config from '../shared/config.js';

export function isDemo() {
  if (typeof api.isDemo === 'function') return api.isDemo();
  if (typeof config.isDemo === 'function') return config.isDemo();
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      localStorage.setItem('hb_demo', '1');
      return true;
    }
    return localStorage.getItem('hb_demo') === '1';
  } catch {
    return false;
  }
}

export async function exitDemo() {
  if (typeof api.exitDemo === 'function') {
    await api.exitDemo();
  } else if (typeof config.exitDemo === 'function') {
    await config.exitDemo();
  } else {
    try {
      localStorage.removeItem('hb_demo');
      localStorage.removeItem('hb_demo_sheet');
      localStorage.removeItem('hb_monitor_token');
      localStorage.removeItem('hb_admin_pin');
      localStorage.removeItem('hb_admin_event_id');
      localStorage.removeItem('hb_admin_monitor_code');
    } catch {}
  }
}

export function initDemoBanner() {
  if (!isDemo()) return;
  if (document.getElementById('demo-banner')) return;

  document.body.classList.add('has-demo-banner');

  const banner = document.createElement('aside');
  banner.id = 'demo-banner';
  banner.className = 'demo-banner glass';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-label', 'Sample event notification');
  banner.innerHTML = `
    <div class="demo-banner-content">
      <span class="demo-banner-text">Sample event. Nothing here is real.</span>
    </div>
    <div class="demo-banner-links">
      <a href="../door/" class="demo-banner-link">Open door scanner</a>
      <a href="../dashboard/" class="demo-banner-link">Open dashboard</a>
      <a href="../t/" class="demo-banner-link">Try a meetup</a>
      <button type="button" class="demo-banner-btn" id="demo-exit-btn">Exit sample</button>
    </div>
  `;

  document.body.prepend(banner);

  document.getElementById('demo-exit-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await exitDemo();
    window.location.href = '../site/';
  });
}
