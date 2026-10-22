// Homebound Pilot Website Script
// Zero external dependencies. Fast, accessible, and resilient.

if (window.__HOMEBOUND_SITE_INIT__) {
  // Already initialized, prevent duplicate execution if loaded via multiple paths
} else {
  window.__HOMEBOUND_SITE_INIT__ = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSite);
  } else {
    initSite();
  }
}

function initSite() {
  initMobileNav();
  initFaqAccordion();
  initPilotForm();
  initHeroPreview();
}

// Mobile navigation toggle
function initMobileNav() {
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  const siteNav = document.querySelector('.site-nav');
  const navLinks = document.querySelectorAll('.nav-link, .nav-cta-btn');

  if (!toggleBtn || !siteNav) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = siteNav.classList.toggle('mobile-open');
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  });

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (siteNav.classList.contains('mobile-open')) {
        siteNav.classList.remove('mobile-open');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
    });
  });
}

// Accessible FAQ Accordion
function initFaqAccordion() {
  const questions = document.querySelectorAll('.faq-question');

  questions.forEach((btn, index) => {
    const parent = btn.closest('.faq-item');
    const answer = parent.querySelector('.faq-answer');
    const id = `faq-answer-${index + 1}`;

    btn.setAttribute('aria-controls', id);
    btn.setAttribute('aria-expanded', 'false');
    answer.setAttribute('id', id);

    btn.addEventListener('click', () => {
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';

      // Close all others for clean UX
      questions.forEach(otherBtn => {
        otherBtn.setAttribute('aria-expanded', 'false');
        otherBtn.closest('.faq-item').classList.remove('open');
      });

      if (!isExpanded) {
        btn.setAttribute('aria-expanded', 'true');
        parent.classList.add('open');
      }
    });
  });
}

// Pilot Sign-up Form with POST /api/pilot & localStorage + mailto fallback
function initPilotForm() {
  const form = document.getElementById('pilot-form');
  const statusSuccess = document.getElementById('form-status-success');
  const statusFallback = document.getElementById('form-status-fallback');
  const submitBtn = document.getElementById('pilot-submit-btn');
  const mailtoBtn = document.getElementById('fallback-mailto-btn');
  const copyBtn = document.getElementById('fallback-copy-btn');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Collect form data
    const chapter = form.chapter.value.trim();
    const school = form.school.value.trim();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const role = form.role.value;
    const rawSize = form.eventSize.value;
    const parsedSize = parseInt(rawSize, 10);
    const eventDate = form.eventDate ? form.eventDate.value.trim() : '';
    const notes = form.notes ? form.notes.value.trim() : '';

    if (!chapter || !school || !name || !email || !role || isNaN(parsedSize)) {
      alert('Please fill in all required fields (marked with *).');
      return;
    }

    const noteParts = [];
    if (name) noteParts.push(`Contact: ${name}`);
    if (role) noteParts.push(`Role: ${role}`);
    if (eventDate) noteParts.push(`Event Date: ${eventDate}`);
    if (notes) noteParts.push(`Notes: ${notes}`);
    const note = noteParts.join(' | ');

    // Backend /api/pilot schema: { chapter, school, email, eventSize?: int, note?: string }
    const apiPayload = {
      chapter: chapter.slice(0, 120),
      school: school.slice(0, 120),
      email: email.slice(0, 254),
      eventSize: Number.isInteger(parsedSize) && parsedSize > 0 ? parsedSize : undefined,
      note: note.slice(0, 2000)
    };

    const localPayload = {
      ...apiPayload,
      name,
      role,
      eventDate,
      notes,
      submittedAt: new Date().toISOString()
    };

    // UI loading state
    submitBtn.disabled = true;
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.textContent = 'Submitting Application...';
    statusSuccess.classList.remove('show');
    statusFallback.classList.remove('show');

    let postedSuccessfully = false;

    try {
      const res = await fetch('/api/pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload)
      });

      if (res.ok) {
        postedSuccessfully = true;
      }
    } catch {
      postedSuccessfully = false;
    }

    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;

    if (postedSuccessfully) {
      statusSuccess.classList.add('show');
      statusSuccess.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      form.reset();
    } else {
      // Endpoint /api/pilot is either offline, returned error, or rate-limited.
      // Store in localStorage and offer mailto + clipboard fallback!
      try {
        const stored = JSON.parse(localStorage.getItem('homebound_pilot_leads') || '[]');
        stored.push(localPayload);
        localStorage.setItem('homebound_pilot_leads', JSON.stringify(stored));
      } catch (storageErr) {
        console.warn('Could not save to localStorage', storageErr);
      }

      // Format email content
      const subjectText = `Homebound Pilot Application - ${chapter} (${school})`;
      const bodyText = [
        `Hi Homebound Pilot Team,`,
        ``,
        `I would like to apply for the Homebound Free Campus Pilot! Here are our details:`,
        ``,
        `• Chapter / Org: ${chapter}`,
        `• University / School: ${school}`,
        `• Contact Name: ${name}`,
        `• Contact Email: ${email}`,
        `• Role: ${role}`,
        `• Typical Event Size: ~${parsedSize} guests`,
        `• Target Event Date: ${eventDate || 'Not specified'}`,
        `• Safety Setup / Notes: ${notes || 'None'}`,
        ``,
        `Thank you!`,
        `${name}`
      ].join('\n');

      const mailtoUrl = `mailto:pilot@homebound.party?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(bodyText)}`;

      if (mailtoBtn) {
        mailtoBtn.href = mailtoUrl;
      }

      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(bodyText);
            const originalCopyText = copyBtn.textContent;
            copyBtn.textContent = '✓ Copied Details!';
            setTimeout(() => {
              copyBtn.textContent = originalCopyText;
            }, 2500);
          } catch {
            alert('Application Details:\n\n' + bodyText);
          }
        };
      }

      statusFallback.classList.add('show');
      statusFallback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

// Live simulated hero preview elements
function initHeroPreview() {
  const liveIndicator = document.querySelector('.live-indicator');
  if (!liveIndicator) return;

  const timeElements = document.querySelectorAll('.feed-time');
  if (timeElements.length > 0) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const h = now.getHours() % 12 || 12;
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    
    timeElements[0].textContent = `${h}:${pad(now.getMinutes())} ${ampm}`;
    const m2 = (now.getMinutes() - 4 + 60) % 60;
    timeElements[1].textContent = `${h}:${pad(m2)} ${ampm}`;
    const m3 = (now.getMinutes() - 9 + 60) % 60;
    timeElements[2].textContent = `${h}:${pad(m3)} ${ampm}`;
  }
}
