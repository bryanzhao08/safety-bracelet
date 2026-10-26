import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../web/app/lib/store.js';
import { createVault, unlock, open } from '../web/app/lib/vault.js';
import { newId } from '../web/app/lib/card.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    keys() {
      return map.keys();
    },
    get rawMap() {
      return map;
    }
  };
}

test('store: self and no_vault errors', async () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);

  const me = { v: 1, id: newId(), n: 'Myself' };
  store.setMe(me);

  const otherCard = { v: 1, id: newId(), n: 'Other' };

  // Fails with no_vault when vault is not configured
  await assert.rejects(
    async () => store.recordScan({ card: otherCard, me }),
    /no_vault/
  );

  // Set vault
  const vault = await createVault('123456');
  store.setVault(vault);

  // Fails with self when scanning own card
  await assert.rejects(
    async () => store.recordScan({ card: me, me }),
    /self/
  );
  await assert.rejects(
    async () => store.recordScan({ card: { v: 1, id: me.id, n: 'Same Id' }, me }),
    /self/
  );
});

test('store: recordScan for new person, then same person again (again:true)', async () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);

  const passcode = '246810';
  const vault = await createVault(passcode);
  store.setVault(vault);

  const me = { v: 1, id: newId(), n: 'Host' };
  store.setMe(me);

  const friendId = newId();
  const friendCard = {
    v: 1,
    id: friendId,
    n: 'Jordan',
    p: '+15551234567',
    ig: 'jordan_k'
  };

  const t1 = '2026-10-24T22:00:00.000Z';
  const res1 = await store.recordScan({ card: friendCard, me, now: t1 });

  assert.equal(res1.isNew, true);
  assert.equal(res1.person.id, friendId);
  assert.equal(res1.person.n, 'Jordan');

  // Stored in people
  assert.equal(store.listPeople().length, 1);
  assert.equal(store.getPerson(friendId).n, 'Jordan');

  // One sealed entry in log
  const log1 = store.listSealed();
  assert.equal(log1.length, 1);

  const privKey = await unlock(vault, passcode);
  const entry1 = await open(privKey, log1[0]);
  assert.equal(entry1.type, 'met');
  assert.equal(entry1.personId, friendId);
  assert.equal(entry1.name, 'Jordan');
  assert.equal(entry1.again, undefined);
  assert.equal(entry1.at, t1);

  // Scan again 20 minutes later (same person)
  const t2 = '2026-10-24T22:20:00.000Z';
  const res2 = await store.recordScan({ card: friendCard, me, now: t2 });

  assert.equal(res2.isNew, false);
  assert.equal(store.listPeople().length, 1); // Not duplicated

  const log2 = store.listSealed();
  assert.equal(log2.length, 2);

  const entry2 = await open(privKey, log2[1]);
  assert.equal(entry2.type, 'met');
  assert.equal(entry2.personId, friendId);
  assert.equal(entry2.again, true);
  assert.equal(entry2.at, t2);
});

test('store: hb_people raw JSON contains no ISO timestamps and no lat', async () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);

  const vault = await createVault('135790');
  store.setVault(vault);

  const me = { v: 1, id: newId(), n: 'Me' };
  store.setMe(me);

  const card = {
    v: 1,
    id: newId(),
    n: 'Priya Patel',
    p: '+15559876543',
    ig: 'priya.patel'
  };

  const loc = { lat: 37.7749, lng: -122.4194, acc: 10 };
  const now = '2026-10-24T23:45:00.000Z';

  await store.recordScan({ card, me, loc, now });

  const rawPeople = storage.getItem('hb_people');
  assert.ok(rawPeople, 'hb_people must exist');

  // Verify privacy invariants on raw JSON
  assert.equal(rawPeople.includes('2026-'), false, 'hb_people must not contain ISO year');
  assert.equal(rawPeople.includes('T23:'), false, 'hb_people must not contain timestamp');
  assert.equal(rawPeople.includes('lat'), false, 'hb_people must not contain lat');
  assert.equal(rawPeople.includes('37.77'), false, 'hb_people must not contain latitude values');
  assert.equal(rawPeople.includes('-122.'), false, 'hb_people must not contain longitude values');

  // But the sealed log entry DOES have loc
  const privKey = await unlock(vault, '135790');
  const sealed = store.listSealed();
  const decrypted = await open(privKey, sealed[0]);
  assert.deepEqual(decrypted.loc, loc);
  assert.equal(decrypted.at, now);
});

test('store: wipe clears every hb_* key', async () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);

  store.setMe({ v: 1, id: newId(), n: 'Me' });
  store.upsertPerson({ v: 1, id: newId(), n: 'Alex' });
  store.setVault(await createVault('112233'));
  store.appendSealed({ epk: {}, iv: 'iv', ct: 'ct' });
  store.setSettings({ location: true, autoLockMin: 10 });

  // Custom extra key to test prefix matching
  storage.setItem('hb_custom_key', 'some_val');
  storage.setItem('unrelated_key', 'keep_me');

  store.wipe();

  assert.equal(store.getMe(), null);
  assert.deepEqual(store.listPeople(), []);
  assert.equal(store.getVault(), null);
  assert.deepEqual(store.listSealed(), []);
  assert.equal(storage.getItem('hb_custom_key'), null);
  assert.equal(storage.getItem('unrelated_key'), 'keep_me');
});
