import { newId, decodeCard } from './card.js';
import { seal } from './vault.js';

function sanitizePersonCard(card) {
  const clean = {
    v: 1,
    id: card.id,
    n: card.n
  };
  if (card.p) clean.p = card.p;
  if (card.ig) clean.ig = card.ig;
  if (card.sc) clean.sc = card.sc;
  if (card.e) clean.e = card.e;
  return clean;
}

export function createStore(storage) {
  function getMe() {
    const raw = storage.getItem('hb_me');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setMe(card) {
    if (!card) {
      storage.removeItem('hb_me');
      return;
    }
    storage.setItem('hb_me', JSON.stringify(sanitizePersonCard(card)));
  }

  function listPeople() {
    const raw = storage.getItem('hb_people');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return [...parsed].sort((a, b) => (a.n || '').localeCompare(b.n || ''));
    } catch {
      return [];
    }
  }

  function getPerson(id) {
    const people = listPeople();
    return people.find(p => p.id === id) || null;
  }

  function upsertPerson(card) {
    const sanitized = sanitizePersonCard(card);
    const people = listPeople();
    const idx = people.findIndex(p => p.id === sanitized.id);
    if (idx >= 0) {
      people[idx] = sanitized;
    } else {
      people.push(sanitized);
    }
    storage.setItem('hb_people', JSON.stringify(people));
    return sanitized;
  }

  function removePerson(id) {
    const people = listPeople().filter(p => p.id !== id);
    storage.setItem('hb_people', JSON.stringify(people));
  }

  function getVault() {
    const raw = storage.getItem('hb_vault');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setVault(meta) {
    if (!meta) {
      storage.removeItem('hb_vault');
      return;
    }
    storage.setItem('hb_vault', JSON.stringify(meta));
  }

  function listSealed() {
    const raw = storage.getItem('hb_log');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function appendSealed(sealed) {
    const log = listSealed();
    log.push(sealed);
    storage.setItem('hb_log', JSON.stringify(log));
  }

  function replaceLog(arr) {
    storage.setItem('hb_log', JSON.stringify(Array.isArray(arr) ? arr : []));
  }

  function getSettings() {
    const defaults = { location: false, autoLockMin: 5 };
    const raw = storage.getItem('hb_settings');
    if (!raw) return defaults;
    try {
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  }

  function setSettings(patch) {
    const current = getSettings();
    const updated = { ...current, ...patch };
    storage.setItem('hb_settings', JSON.stringify(updated));
    return updated;
  }

  function wipe() {
    const known = ['hb_me', 'hb_people', 'hb_vault', 'hb_log', 'hb_settings'];
    for (const k of known) {
      storage.removeItem(k);
    }
    if (typeof storage.keys === 'function') {
      for (const k of storage.keys()) {
        if (k && k.startsWith('hb_')) storage.removeItem(k);
      }
    } else if (typeof storage.length === 'number' && typeof storage.key === 'function') {
      const toRemove = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith('hb_')) toRemove.push(k);
      }
      for (const k of toRemove) storage.removeItem(k);
    } else {
      for (const k of Object.keys(storage)) {
        if (k && k.startsWith('hb_')) storage.removeItem(k);
      }
    }
  }

  async function recordScan({ card, me, loc, now }) {
    const vault = getVault();
    if (!vault) {
      throw new Error('no_vault');
    }

    const cardObj = typeof card === 'string' ? decodeCard(card) : card;
    const myId = me?.id || (typeof me === 'string' ? me : null);
    if (myId && cardObj.id === myId) {
      throw new Error('self');
    }

    const existing = getPerson(cardObj.id);
    const isNew = !existing;
    const person = upsertPerson(cardObj);

    const at = now
      ? (typeof now === 'string' ? now : new Date(now).toISOString())
      : new Date().toISOString();

    const entry = {
      id: newId(),
      type: 'met',
      at,
      personId: person.id,
      name: person.n
    };

    if (!isNew) {
      entry.again = true;
    }
    if (loc) {
      entry.loc = loc;
    }

    const sealed = await seal(vault, entry);
    appendSealed(sealed);

    return { person, isNew };
  }

  return {
    getMe,
    setMe,
    listPeople,
    getPerson,
    upsertPerson,
    removePerson,
    getVault,
    setVault,
    listSealed,
    appendSealed,
    replaceLog,
    getSettings,
    setSettings,
    wipe,
    recordScan
  };
}
