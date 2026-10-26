// web/site/site.js - Marketing site navigation & interactive tilting pass mock
import { generateQRSvg } from '../shared/qr.js';

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Navigation
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

  const sheetLinks = navSheet?.querySelectorAll('a');
  sheetLinks?.forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navSheet?.classList.contains('is-open')) {
      closeMenu();
    }
  });

  // Render Real Dynamic QR into Pass Mock
  const qrTarget = document.getElementById('pass-qr-target');
  if (qrTarget && typeof generateQRSvg === 'function') {
    try {
      // Maya Kim sample card link
      const sampleCard = {
        v: 1,
        id: 'mayakim001',
        n: 'Maya Kim',
        ig: 'maya.k',
        sc: 'mayak',
        tt: 'mayakim'
      };
      const b64 = btoa(JSON.stringify(sampleCard)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const qrUrl = `https://homebound.party/app/#add=${b64}`;
      const svg = generateQRSvg(qrUrl, { size: 168, margin: 2, color: '#0A1636', bgColor: '#FFFFFF' });
      if (svg) {
        qrTarget.innerHTML = svg;
      }
    } catch {
      // Keep static SVG fallback if generation fails
    }
  }

  // Interactive Live Tilting Glass Pass
  const passCard = document.getElementById('hero-pass');
  const passWrapper = document.getElementById('pass-tilt-wrapper');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (passCard && !prefersReducedMotion.matches) {
    let currentTiltX = 0;
    let currentTiltY = 0;
    let targetTiltX = 0;
    let targetTiltY = 0;
    let rimX = 40;
    let rimY = 15;
    let animFrame = null;

    function updatePass() {
      // Smooth interpolation towards target
      currentTiltX += (targetTiltX - currentTiltX) * 0.15;
      currentTiltY += (targetTiltY - currentTiltY) * 0.15;

      passCard.style.setProperty('--tilt-x', `${currentTiltX.toFixed(2)}deg`);
      passCard.style.setProperty('--tilt-y', `${currentTiltY.toFixed(2)}deg`);
      passCard.style.setProperty('--rim-x', `${rimX.toFixed(1)}%`);
      passCard.style.setProperty('--rim-y', `${rimY.toFixed(1)}%`);

      if (Math.abs(targetTiltX - currentTiltX) > 0.05 || Math.abs(targetTiltY - currentTiltY) > 0.05) {
        animFrame = requestAnimationFrame(updatePass);
      } else {
        animFrame = null;
      }
    }

    function scheduleUpdate() {
      if (!animFrame) {
        animFrame = requestAnimationFrame(updatePass);
      }
    }

    // Pointer-based tilt on desktop / touch
    if (passWrapper) {
      passWrapper.addEventListener('mousemove', (e) => {
        const rect = passCard.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const normX = (e.clientX - centerX) / (rect.width / 2);
        const normY = (e.clientY - centerY) / (rect.height / 2);

        // Clamped tilt angles (±12 deg)
        targetTiltX = Math.max(-12, Math.min(12, -normY * 12));
        targetTiltY = Math.max(-12, Math.min(12, normX * 12));

        rimX = Math.max(10, Math.min(90, 50 + normX * 40));
        rimY = Math.max(5, Math.min(85, 40 + normY * 35));

        scheduleUpdate();
      });

      passWrapper.addEventListener('mouseleave', () => {
        targetTiltX = 0;
        targetTiltY = 0;
        rimX = 40;
        rimY = 15;
        scheduleUpdate();
      });
    }

    // Device orientation tilt on phones (when permitted)
    if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
      window.addEventListener('deviceorientation', (e) => {
        if (e.gamma === null || e.beta === null) return;
        // gamma: left/right tilt [-90, 90]
        // beta: front/back tilt [-180, 180] (holding phone upright is ~45-60 deg)
        const g = Math.max(-30, Math.min(30, e.gamma));
        const b = Math.max(-30, Math.min(30, e.beta - 45));

        targetTiltY = (g / 30) * 12;
        targetTiltX = -(b / 30) * 12;

        rimX = 50 + (g / 30) * 35;
        rimY = 30 + (b / 30) * 30;

        scheduleUpdate();
      }, { passive: true });
    }
  }
});
