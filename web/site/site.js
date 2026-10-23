// web/site/site.js - Marketing site navigation & mobile menu logic

import * as api from '../shared/api.js';
import * as config from '../shared/config.js';

document.addEventListener('DOMContentLoaded', () => {
  const tryDemoBtn = document.getElementById('btn-try-demo');
  if (tryDemoBtn) {
    tryDemoBtn.addEventListener('click', async () => {
      tryDemoBtn.disabled = true;
      tryDemoBtn.textContent = 'Loading sample...';
      try {
        if (typeof api.startDemo === 'function') {
          await api.startDemo();
        } else if (typeof config.startDemo === 'function') {
          await config.startDemo();
        } else {
          try {
            localStorage.setItem('hb_demo', '1');
          } catch {}
        }
      } catch (err) {
        console.error('Failed to start demo:', err);
      }
      window.location.href = '../dashboard/';
    });
  }

  const menuBtn = document.getElementById('mobile-menu-btn');
  const closeBtn = document.getElementById('mobile-close-btn');
  const navSheet = document.getElementById('mobile-nav-sheet');
  const backdrop = document.getElementById('mobile-nav-backdrop');

  function openMenu() {
    if (!navSheet || !backdrop) return;
    navSheet.classList.add('is-open');
    backdrop.classList.add('is-open');
    navSheet.setAttribute('aria-hidden', 'false');
    backdrop.setAttribute('aria-hidden', 'false');
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'true');
    }
  }

  function closeMenu() {
    if (!navSheet || !backdrop) return;
    navSheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    navSheet.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('aria-hidden', 'true');
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const isOpen = navSheet?.classList.contains('is-open');
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeMenu);
  }

  if (backdrop) {
    backdrop.addEventListener('click', closeMenu);
  }

  // Close menu when clicking any mobile navigation link or action
  const sheetLinks = navSheet?.querySelectorAll('a');
  sheetLinks?.forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navSheet?.classList.contains('is-open')) {
      closeMenu();
    }
  });
});
