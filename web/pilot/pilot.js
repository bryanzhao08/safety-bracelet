// web/pilot/pilot.js - Pilot program signup logic
import { submitPilot } from '../shared/api.js';
import * as api from '../shared/api.js';
import * as config from '../shared/config.js';

document.addEventListener('DOMContentLoaded', () => {
  // Demo Event CTA
  const demoBtn = document.getElementById('btn-pilot-demo');
  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      demoBtn.disabled = true;
      demoBtn.textContent = 'Loading sample...';
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

  // Mobile Menu Logic
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

  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (backdrop) backdrop.addEventListener('click', closeMenu);

  navSheet?.querySelectorAll('a')?.forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navSheet?.classList.contains('is-open')) {
      closeMenu();
    }
  });

  // Pilot Form Submission
  const form = document.getElementById('pilot-form');
  const submitBtn = document.getElementById('pilot-submit-btn');
  const statusSuccess = document.getElementById('pilot-status-success');
  const statusError = document.getElementById('pilot-status-error');
  const errorText = document.getElementById('pilot-error-text');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Reset feedback
      statusSuccess?.classList.add('hidden');
      statusError?.classList.add('hidden');

      const chapter = document.getElementById('pilot-chapter')?.value.trim();
      const school = document.getElementById('pilot-school')?.value.trim();
      const email = document.getElementById('pilot-email')?.value.trim();
      const sizeVal = document.getElementById('pilot-size')?.value;
      const eventSize = sizeVal ? parseInt(sizeVal, 10) : null;
      const note = document.getElementById('pilot-notes')?.value.trim();

      if (!chapter || !school || !email) {
        if (statusError && errorText) {
          errorText.textContent = 'Please fill out your chapter, school, and email.';
          statusError.classList.remove('hidden');
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting request...';
      }

      const lead = {
        chapter,
        school,
        email,
        eventSize,
        note: note || undefined,
        submittedAt: new Date().toISOString(),
      };

      let success = false;
      try {
        const res = await submitPilot({ chapter, school, email, eventSize, note });
        if (res && (res.ok || res.id || res.success || res.status === 201 || !res.error)) {
          success = true;
        } else if (res && res.error) {
          throw new Error(res.message || res.error);
        } else {
          success = true;
        }
      } catch (err) {
        console.warn('submitPilot network error, saving to localStorage:', err);
        // If rate limited or network failure, still save locally
        try {
          const stored = JSON.parse(localStorage.getItem('homebound_pilot_leads') || '[]');
          stored.push(lead);
          localStorage.setItem('homebound_pilot_leads', JSON.stringify(stored));
          // Consider offline lead saved as success for user experience
          success = true;
        } catch (storageErr) {
          console.warn('LocalStorage lead save failed:', storageErr);
        }
      }

      if (success) {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Request submitted';
        }
        if (statusSuccess) {
          statusSuccess.classList.remove('hidden');
          statusSuccess.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        form.reset();
      } else {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit pilot request';
        }
        if (statusError && errorText) {
          errorText.textContent = 'Could not submit request. Please try again or email us directly.';
          statusError.classList.remove('hidden');
        }
      }
    });
  }
});
