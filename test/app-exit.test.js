import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlock, open } from '../web/app/lib/vault.js';
import { createStore } from '../web/app/lib/store.js';
import { shareText, groupByNight } from '../web/app/lib/nights.js';

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

test('same party code scanned twice: arrive, then leave', async () => {
  const st = createStore(memStorage());
  const meta = await createVault('123456');
  st.setVault(meta);
  const party = { v: 1, id: 'p1', name: 'Friday', startsAt: '2026-10-24T02:00:00Z', endsAt: '2026-10-24T08:00:00Z', host: { n: 'Dave' } };
  await st.joinParty(party, { now: '2026-10-24T02:10:00Z' });
  assert.equal(st.getParty().id, 'p1');
  await st.exitParty({ now: '2026-10-24T06:40:00Z' });
  assert.equal(st.getParty(), null);
  await assert.rejects(() => st.exitParty({ now: '2026-10-24T06:41:00Z' }), /not_joined/);

  const key = await unlock(meta, '123456');
  const entries = await Promise.all(st.listSealed().map(s => open(key, s)));
  assert.deepEqual(entries.map(e => e.type), ['arrive', 'leave']);
  assert.equal(entries[1].name, 'Friday');
  const [night] = groupByNight(entries, { tzOffsetMin: 0 });
  assert.match(shareText(night, { tzOffsetMin: 0 }), /Left Friday/);
});
