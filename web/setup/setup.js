// web/setup/setup.js - Setup client for Google Sheets backend

import { generateQRSvg } from '../shared/qr.js';
import { saveAdminSession, getAdminPin } from '../shared/api.js';
import { getBackend, setSheetsUrl } from '../shared/config.js';

const alertBox = document.getElementById('alertBox');
const connectForm = document.getElementById('connectForm');
const sheetUrlInput = document.getElementById('sheetUrlInput');
const connectBtn = document.getElementById('connectBtn');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const copyFeedback = document.getElementById('copyFeedback');

const pinCard = document.getElementById('pinCard');
const pinForm = document.getElementById('pinForm');
const adminPinInput = document.getElementById('adminPinInput');
const verifyPinBtn = document.getElementById('verifyPinBtn');

const readyCard = document.getElementById('readyCard');
const readyEventName = document.getElementById('readyEventName');
const displayAdminPin = document.getElementById('displayAdminPin');
const displayMonitorCode = document.getElementById('displayMonitorCode');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const monitorLinkInput = document.getElementById('monitorLinkInput');
const copyMonitorLinkBtn = document.getElementById('copyMonitorLinkBtn');

let activeSheetUrl = '';

function showAlert(message, isError = true) {
  alertBox.textContent = message;
  alertBox.className = `alert-banner ${isError ? 'alert-error' : 'alert-success'}`;
  alertBox.style.display = 'block';
}

function hideAlert() {
  alertBox.style.display = 'none';
}

// Prefill existing URL if available
const currentBackend = getBackend();
if (currentBackend.type === 'sheets' && currentBackend.url) {
  sheetUrlInput.value = currentBackend.url;
  activeSheetUrl = currentBackend.url;
}

// 1. Copy Apps Script Code button
copyCodeBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('./Code.gs');
    if (!res.ok) throw new Error(`Could not fetch Code.gs (${res.status})`);
    const code = await res.text();
    await navigator.clipboard.writeText(code);

    copyFeedback.style.display = 'inline';
    setTimeout(() => {
      copyFeedback.style.display = 'none';
    }, 4000);
  } catch (err) {
    showAlert(`Failed to copy code: ${err.message}. You can find sheets/Code.gs in the repository.`);
  }
});

// 2. Connect & test web app URL with 'ping'
connectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const url = sheetUrlInput.value.trim();
  if (!url) return;

  connectBtn.disabled = true;
  connectBtn.textContent = 'Testing connection...';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping' }),
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.message || data.error);
    }

    activeSheetUrl = url;
    setSheetsUrl(url);

    showAlert(`Connected successfully to "${data.eventName || 'Homebound Event'}". Please verify your Admin PIN.`, false);

    // Show PIN verification card
    pinCard.style.display = 'block';
    adminPinInput.focus();

    // Check if an existing admin PIN is saved
    const savedPin = getAdminPin();
    if (savedPin) {
      adminPinInput.value = savedPin;
    }
  } catch (err) {
    showAlert(`Connection failed: ${err.message}. Make sure the web app is deployed with 'Anyone' access.`);
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect & Test Connection';
  }
});

// 3. Verify Admin PIN with 'event' action
pinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const pin = adminPinInput.value.trim();
  if (!pin || pin.length !== 8) {
    showAlert('Admin PIN must be 8 digits.');
    return;
  }

  verifyPinBtn.disabled = true;
  verifyPinBtn.textContent = 'Verifying PIN...';

  try {
    const res = await fetch(activeSheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'event', auth: { adminPin: pin } }),
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.message || data.error);
    }

    const event = data.event;
    saveAdminSession({
      eventId: event.id,
      adminPin: pin,
      monitorCode: event.monitorCode,
    });

    // Populate Ready Card
    readyEventName.textContent = event.name || 'Homebound Event';
    displayAdminPin.textContent = pin;
    displayMonitorCode.textContent = event.monitorCode || '—';

    // Generate monitor door link and QR code
    const origin = window.location.origin;
    const basePath = window.location.pathname.replace(/\/setup\/.*$|\/setup$/, '');
    const doorUrl = `${origin}${basePath}/door/?sheet=${encodeURIComponent(activeSheetUrl)}`;

    monitorLinkInput.value = doorUrl;
    qrCodeContainer.innerHTML = generateQRSvg(doorUrl, { size: 200, margin: 2 });

    pinCard.style.display = 'none';
    readyCard.style.display = 'block';
    showAlert('Setup completed! Door monitors can now use the QR code or link below.', false);
  } catch (err) {
    showAlert(`PIN verification failed: ${err.message}. Make sure you typed the 8-digit PIN from the setup alert.`);
  } finally {
    verifyPinBtn.disabled = false;
    verifyPinBtn.textContent = 'Verify & Unlock Event';
  }
});

// 4. Copy monitor link button
copyMonitorLinkBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(monitorLinkInput.value);
    const orig = copyMonitorLinkBtn.textContent;
    copyMonitorLinkBtn.textContent = 'Copied Link!';
    setTimeout(() => {
      copyMonitorLinkBtn.textContent = orig;
    }, 2500);
  } catch (_) {
    monitorLinkInput.select();
  }
});
