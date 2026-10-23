// web/site/site.js - Pilot landing page logic
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('pilot-form');
  const submitBtn = document.getElementById('pilot-submit-btn');
  const statusSuccess = document.getElementById('pilot-status-success');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const chapter = document.getElementById('pilot-chapter')?.value.trim();
      const school = document.getElementById('pilot-school')?.value.trim();
      const email = document.getElementById('pilot-email')?.value.trim();
      const eventSize = document.getElementById('pilot-size')?.value;
      const notes = document.getElementById('pilot-notes')?.value.trim();

      const lead = {
        chapter,
        school,
        email,
        eventSize,
        notes,
        submittedAt: new Date().toISOString(),
      };

      try {
        const stored = JSON.parse(localStorage.getItem('homebound_pilot_leads') || '[]');
        stored.push(lead);
        localStorage.setItem('homebound_pilot_leads', JSON.stringify(stored));
      } catch (err) {
        console.warn('LocalStorage lead save fallback', err);
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Application received!';
      }

      if (statusSuccess) {
        statusSuccess.classList.remove('hidden');
        statusSuccess.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      form.reset();
    });
  }
});
