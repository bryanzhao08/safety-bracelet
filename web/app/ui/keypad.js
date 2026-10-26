// web/app/ui/keypad.js - iPhone-style passcode keypad (dots + 10 round number keys)
const LETTERS = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' };

/**
 * Render a keypad into `root`.
 * opts: { title, subtitle, length=6, leftLabel, onLeft, onInput(code), onComplete(code) }
 * onComplete may be async; while it runs, input is ignored.
 * Returns { reset(), shake(message), setText(title, subtitle), setLength(n), destroy() }.
 */
export function mountKeypad(root, opts = {}) {
  let length = opts.length || 6;
  let code = '';
  let busy = false;

  root.classList.add('ipk');
  root.innerHTML = `
    <h2 class="ipk-title"></h2>
    <p class="ipk-sub"></p>
    <div class="ipk-dots" aria-hidden="true"></div>
    <p class="ipk-error" aria-live="assertive"></p>
    <div class="ipk-grid" role="group" aria-label="Passcode keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digitKey).join('')}
      <button type="button" class="ipk-text ipk-left">${opts.leftLabel || ''}</button>
      ${digitKey(0)}
      <button type="button" class="ipk-text ipk-del" aria-label="Delete">Delete</button>
    </div>`;

  const titleEl = root.querySelector('.ipk-title');
  const subEl = root.querySelector('.ipk-sub');
  const dotsEl = root.querySelector('.ipk-dots');
  const errEl = root.querySelector('.ipk-error');
  const leftBtn = root.querySelector('.ipk-left');
  const delBtn = root.querySelector('.ipk-del');

  function setText(title, subtitle) {
    titleEl.textContent = title || '';
    subEl.textContent = subtitle || '';
    subEl.hidden = !subtitle;
  }

  function render() {
    if (dotsEl.children.length !== length) {
      dotsEl.innerHTML = '<span class="ipk-dot"></span>'.repeat(length);
    }
    [...dotsEl.children].forEach((d, i) => d.classList.toggle('on', i < code.length));
    delBtn.style.visibility = code.length ? 'visible' : 'hidden';
    leftBtn.style.visibility = opts.leftLabel ? 'visible' : 'hidden';
  }

  async function press(digit) {
    if (busy || code.length >= length) return;
    errEl.textContent = '';
    code += digit;
    render();
    opts.onInput?.(code);
    if (code.length === length && opts.onComplete) {
      busy = true;
      // Let the last dot paint before work starts (PBKDF2 can take a moment)
      await new Promise(r => setTimeout(r, 120));
      try { await opts.onComplete(code); } finally { busy = false; }
    }
  }

  function del() {
    if (busy || !code) return;
    code = code.slice(0, -1);
    render();
  }

  root.querySelector('.ipk-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.digit !== undefined) press(btn.dataset.digit);
    else if (btn === delBtn) del();
    else if (btn === leftBtn) opts.onLeft?.();
  });

  function onKey(e) {
    if (!root.isConnected || root.offsetParent === null) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { del(); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  setText(opts.title, opts.subtitle);
  render();

  return {
    reset() { code = ''; errEl.textContent = ''; render(); },
    shake(message) {
      code = '';
      render();
      errEl.textContent = message || '';
      dotsEl.classList.remove('shake');
      void dotsEl.offsetWidth;
      dotsEl.classList.add('shake');
      navigator.vibrate?.(80);
    },
    setText,
    setLength(n) { length = n; render(); },
    get code() { return code; },
    destroy() { document.removeEventListener('keydown', onKey); root.innerHTML = ''; },
  };
}

function digitKey(d) {
  const letters = LETTERS[d] || '';
  return `<button type="button" class="ipk-key" data-digit="${d}" aria-label="${d}">
    <span class="ipk-num">${d}</span>${letters ? `<span class="ipk-abc">${letters}</span>` : ''}
  </button>`;
}

/**
 * Full-screen keypad overlay. Resolves with the code, or null if cancelled.
 * opts: { title, subtitle, length=6, cancelLabel='Cancel', check(code) -> string|null (error to shake) }
 */
export function askPasscode(opts = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ipk-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const inner = document.createElement('div');
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    const close = (value) => { pad.destroy(); overlay.remove(); resolve(value); };
    const pad = mountKeypad(inner, {
      title: opts.title,
      subtitle: opts.subtitle,
      length: opts.length || 6,
      leftLabel: opts.cancelLabel === null ? '' : (opts.cancelLabel || 'Cancel'),
      onLeft: () => close(null),
      onComplete: async (code) => {
        const err = opts.check ? await opts.check(code) : null;
        if (err) pad.shake(err); else close(code);
      },
    });
  });
}

/** Create-and-confirm flow. Resolves with the new 6-digit passcode, or null if cancelled. */
export async function createPasscode({ title = 'Create a passcode', subtitle, cancelLabel } = {}) {
  let sub = subtitle;
  for (;;) {
    const first = await askPasscode({ title, subtitle: sub, cancelLabel });
    if (first === null) return null;
    const second = await askPasscode({ title: 'Re-enter your passcode', subtitle: 'Type the same 6 digits again.', cancelLabel });
    if (second === null) return null;
    if (second === first) return first;
    sub = 'Passcodes didn’t match. Try again.';
  }
}
