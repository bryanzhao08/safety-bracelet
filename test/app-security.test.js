import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { test } from 'node:test';
import { decodeCard, newId } from '../web/app/lib/card.js';
import { createVault, seal, unlock, open } from '../web/app/lib/vault.js';
import { createStore } from '../web/app/lib/store.js';

const flip = encoded => {
  const bytes = Buffer.from(encoded, 'base64url');
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  return bytes.toString('base64url');
};
const encodedCard = card => Buffer.from(JSON.stringify(card)).toString('base64url');
const validCard = () => ({ v: 1, id: newId(), n: 'Jordan', p: '+15551234567' });

test('sealed entries reject ciphertext and nonce tampering; wrapped private keys cannot be tampered open', async () => {
  const meta = await createVault('642813');
  const privateKey = await unlock(meta, '642813');
  const sealed = await seal(meta, { id: 'event-1', type: 'note', at: new Date().toISOString(), text: 'Private note' });
  for (const field of ['ct', 'iv']) {
    await assert.rejects(open(privateKey, { ...sealed, [field]: flip(sealed[field]) }), { message: 'corrupt' });
  }
  const changed = structuredClone(meta);
  changed.wrapped.ct = flip(changed.wrapped.ct);
  await assert.rejects(unlock(changed, '642813'));
});

test('vault metadata uses costly passcode derivation and never stores a plaintext private key', async () => {
  const meta = await createVault('642813');
  assert.ok(meta.iter >= 310_000);
  const serialized = JSON.stringify(meta);
  assert.doesNotMatch(serialized, /"d"\s*:/);
  const privateKey = await unlock(meta, '642813');
  try {
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
    assert.equal(serialized.includes(pkcs8), false);
    assert.equal(serialized.includes(Buffer.from(pkcs8, 'base64').toString('base64url')), false);
  } catch (error) {
    if (error.name !== 'InvalidAccessException' && error.name !== 'InvalidAccessError') throw error;
  }
  const wrongPasscodes = new Set();
  while (wrongPasscodes.size < 3) {
    const candidate = String(randomInt(1_000_000)).padStart(6, '0');
    if (candidate !== '642813') wrongPasscodes.add(candidate);
  }
  for (const wrong of wrongPasscodes) {
    await assert.rejects(unlock(meta, wrong), { message: 'bad_passcode' });
  }
  const changedIterations = { ...meta, iter: 1 };
  await assert.rejects(unlock(changedIterations, '642813'));
});

test('three scans and a note leave only encrypted history; public people have no times or location', async () => {
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
  const store = createStore(storage);
  const meta = await createVault('642813');
  store.setVault(meta);
  const me = { v: 1, id: newId(), n: 'Quetzal Own' };
  store.setMe(me);
  const people = [
    { v: 1, id: newId(), n: 'Xylophone Rowan', p: '+15551234567' },
    { v: 1, id: newId(), n: 'Zephyr Morrow', ig: 'zephyr.m' },
  ];
  const loc = { lat: 37.7749, lng: -122.4194, acc: 82 };
  await store.recordScan({ card: people[0], me, loc });
  await store.recordScan({ card: people[1], me, loc });
  await store.recordScan({ card: people[0], me, loc });
  store.appendSealed(await seal(meta, { id: newId(), type: 'note', at: '2026-10-26T03:14:15.000Z', text: 'At the private porch', loc }));
  const rawLog = storage.getItem('hb_log');
  assert.ok(rawLog);
  for (const secret of ['Xylophone Rowan', 'Zephyr Morrow', 'At the private porch', '37.7749', '122.4194', '2026-10-26T03:14:15.000Z']) {
    assert.equal(rawLog.includes(secret), false, `hb_log leaked ${secret}`);
  }
  assert.doesNotMatch(rawLog, /20\d\d-\d\d-\d\dT\d\d:\d\d/);
  assert.equal(store.listSealed().length, 4);
  const rawPeople = storage.getItem('hb_people');
  assert.ok(rawPeople.includes('Xylophone Rowan'));
  assert.doesNotMatch(rawPeople, /\d{4}-\d\d-\d\dT\d\d:\d\d/);
  assert.doesNotMatch(rawPeople, /"(?:lat|lng|loc|at|lastSeen)"\s*:/);
  const allValues = [...data.entries()].filter(([key]) => key.startsWith('hb_')).map(([, value]) => value).join('\n');
  assert.doesNotMatch(allValues, /"d"\s*:/);
  try {
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', await unlock(meta, '642813')));
    assert.equal(allValues.includes(pkcs8.toString('base64')), false);
    assert.equal(allValues.includes(pkcs8.toString('base64url')), false);
  } catch (error) {
    if (error.name !== 'InvalidAccessException' && error.name !== 'InvalidAccessError') throw error;
  }
});

test('another vault cannot read sealed entries', async () => {
  const first = await createVault('642813');
  const second = await createVault('917245');
  const ciphertext = await seal(first, { id: 'only-first', type: 'home', at: new Date().toISOString() });
  await assert.rejects(open(await unlock(second, '917245'), ciphertext), { message: 'corrupt' });
});

test('decodeCard rejects scripts, oversize names and payloads, and non-JSON', () => {
  const valid = validCard();
  const hostile = [
    ['script name', { ...valid, n: '<script>alert(1)</script>' }],
    ['javascript name', { ...valid, n: 'javascript:alert(1)' }],
    ['javascript phone', { ...valid, p: 'javascript:alert(1)' }],
    ['script Instagram', { ...valid, ig: '<script>' }],
    ['javascript Snapchat', { ...valid, sc: 'javascript:alert(1)' }],
    ['script email', { ...valid, e: '<script>@example.com' }],
    ['HTML email', { ...valid, e: '<img src=x onerror=alert(1)>@example.com' }],
    ['script id', { ...valid, id: '<script>' }],
    ['overlong name', { ...valid, n: 'A'.repeat(41) }],
    ['over 2 KB payload', { ...valid, extra: 'A'.repeat(2100) }],
  ];
  const accepted = [];
  for (const [label, card] of hostile) {
    try { decodeCard(encodedCard(card)); accepted.push(label); }
    catch (error) { assert.equal(error.message, 'bad_card', label); }
  }
  assert.deepEqual(accepted, [], `Hostile cards accepted: ${accepted.join(', ')}`);
  assert.throws(() => decodeCard(Buffer.from('not JSON').toString('base64url')), { message: 'bad_card' });
});
