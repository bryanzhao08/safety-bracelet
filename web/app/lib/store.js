import { newId, decodeCard } from './card.js';
import { encodeParty, decodeParty } from './party.js';
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
  if (card.tt) clean.tt = card.tt;
  if (card.x) clean.x = card.x;
  if (card.li) clean.li = card.li;
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

  const parse = (key, fallback) => {
    try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const timestamp = now => now ? new Date(now).toISOString() : new Date().toISOString();
  async function sealedEntry(entry) {
    const vault = getVault();
    if (!vault) throw new Error('no_vault');
    const sealed = await seal(vault, { id: newId(), ...entry });
    appendSealed(sealed);
    return sealed;
  }

  function getParty() {
    const raw = parse('hb_party', null);
    if (!raw) return null;
    try { return decodeParty(encodeParty(raw)); } catch { return null; }
  }

  async function joinParty(party, { now, loc } = {}) {
    const clean = decodeParty(encodeParty(party));
    const entry = { type: 'arrive', at: timestamp(now), partyId: clean.id, name: clean.name };
    if (loc) entry.loc = loc;
    await sealedEntry(entry);
    storage.setItem('hb_party', JSON.stringify(clean));
    storage.setItem('hb_party_home', 'false');
    return clean;
  }

  function leaveParty() {
    storage.removeItem('hb_party');
    storage.removeItem('hb_party_home');
  }

  function listHosted() {
    const hosted = parse('hb_hosted', []);
    return Array.isArray(hosted) ? hosted : [];
  }

  function saveHosted(party) {
    const clean = decodeParty(encodeParty(party));
    const hosted = listHosted().filter(item => item.id !== clean.id);
    hosted.push(clean);
    storage.setItem('hb_hosted', JSON.stringify(hosted));
    return clean;
  }

  function removeHosted(id) {
    storage.setItem('hb_hosted', JSON.stringify(listHosted().filter(item => item.id !== id)));
  }

  function getShare() {
    const share = parse('hb_share', {});
    return share && typeof share === 'object' && !Array.isArray(share) ? share : {};
  }

  function setShare(patch) {
    const share = { ...getShare() };
    for (const key of ['p', 'e', 'ig', 'sc', 'tt', 'x', 'li']) {
      if (Object.hasOwn(patch || {}, key)) share[key] = patch[key] !== false;
    }
    storage.setItem('hb_share', JSON.stringify(share));
    return share;
  }

  function homeReminderDue(now = new Date()) {
    const party = getParty();
    return Boolean(party?.ask?.home && new Date(now).getTime() > Date.parse(party.endsAt) && parse('hb_party_home', false) !== true);
  }

  async function recordHome({ now, loc } = {}) {
    const entry = { type: 'home', at: timestamp(now) };
    if (loc) entry.loc = loc;
    const sealed = await sealedEntry(entry);
    const party = getParty();
    if (party && Date.parse(entry.at) >= Date.parse(party.startsAt)) storage.setItem('hb_party_home', 'true');
    return sealed;
  }

  async function recordNote({ text, now, loc } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 280) throw new Error('bad_note');
    const entry = { type: 'note', at: timestamp(now), text: text.trim() };
    if (loc) entry.loc = loc;
    return sealedEntry(entry);
  }

  function wipe() {
    const known = ['hb_me', 'hb_people', 'hb_vault', 'hb_log', 'hb_settings', 'hb_party', 'hb_party_home', 'hb_hosted', 'hb_share'];
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

    const party = getParty();
    if (party) entry.partyId = party.id;

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
    getParty,
    joinParty,
    leaveParty,
    listHosted,
    saveHosted,
    removeHosted,
    getShare,
    setShare,
    homeReminderDue,
    recordHome,
    recordNote,
    wipe,
    recordScan
  };
}
