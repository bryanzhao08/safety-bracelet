import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, parseProfileLink, profileUrl, shareableCard, encodeCard, decodeCard, parseScan, vcard } from '../web/app/lib/card.js';
import { encodeParty, decodeParty, partyUrl } from '../web/app/lib/party.js';
import { createStore } from '../web/app/lib/store.js';
import { createVault, unlock, open, isLegacyPasscode, changePasscode } from '../web/app/lib/vault.js';
import { bytesToBase64Url } from '../web/app/lib/b64.js';
import { recap, shareText } from '../web/app/lib/nights.js';

const party = { v: 1, id: 'party1', name: 'Autumn Night', startsAt: '2026-10-26T20:00:00.000Z', endsAt: '2026-10-27T02:00:00.000Z', host: { n: 'Maya', p: '+15551234567' }, ride: 'North gate', note: 'Bring a coat', ask: { home: true } };
const makeStorage = () => { const map = new Map(); return { map, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k), keys: () => map.keys() }; };

test('v2 social links parse supported forms and reject short or unrelated links', () => {
  const cases = [
    ['instagram.com/maya.lin/?igsh=abc', 'ig', 'maya.lin'],
    ['https://www.instagram.com/maya.lin/', 'ig', 'maya.lin'],
    ['m.instagram.com/maya.lin', 'ig', 'maya.lin'],
    ['snapchat.com/add/Maya-1', 'sc', 'Maya-1'],
    ['https://www.snapchat.com/add/Maya-1?x=y', 'sc', 'Maya-1'],
    ['tiktok.com/@maya.lin', 'tt', 'maya.lin'],
    ['https://m.tiktok.com/@maya.lin/', 'tt', 'maya.lin'],
    ['x.com/maya_1', 'x', 'maya_1'],
    ['twitter.com/maya_1', 'x', 'maya_1'],
    ['linkedin.com/in/maya-lin', 'li', 'maya-lin']
  ];
  for (const [input, platform, handle] of cases) assert.deepEqual(parseProfileLink(input), { platform, handle }, input);
  assert.deepEqual(parseProfileLink('@maya'), { platform: null, handle: 'maya' });
  for (const value of ['snapchat.com/t/abc', 'https://evil.com/x', 'instagram.com/a/b', 'tiktok.com/maya', 'linkedin.com/company/foo', 'javascript:alert(1)', 'garbage', '']) assert.equal(parseProfileLink(value), null, value);
});

test('v2 platform URL, card filtering, social validation and vCard links', () => {
  assert.deepEqual(PLATFORMS.map(p => p.key), ['ig','sc','tt','x','li']);
  for (const p of PLATFORMS) assert.ok(p.label && p.placeholder && p.shareHelp);
  const urls = { ig: 'https://instagram.com/maya', sc: 'https://snapchat.com/add/maya', tt: 'https://www.tiktok.com/@maya', x: 'https://x.com/maya', li: 'https://www.linkedin.com/in/maya' };
  for (const [key, url] of Object.entries(urls)) assert.equal(profileUrl(key, 'maya'), url);
  const me = decodeCard(encodeCard({ id:'myid', n:'Maya', p:'+15551234567', e:'maya@example.com', ig:'@maya', sc:'@maya', tt:'@maya', x:'@maya', li:'@maya' }));
  assert.equal(me.tt, 'maya');
  const shared = shareableCard(me, { p:false, e:false, sc:false, x:false });
  assert.deepEqual(Object.keys(shared).sort(), ['id','ig','li','n','tt','v']);
  const vc = vcard(me);
  for (const url of Object.values(urls)) assert.ok(vc.includes(`URL:${url}`));
  assert.throws(() => encodeCard({ id:'x', n:'Maya', sc:'ab' }), /bad_card/);
});

test('v2 party QR round trip and hostile inputs', () => {
  const encoded = encodeParty(party);
  assert.deepEqual(decodeParty(encoded), party);
  assert.deepEqual(parseScan(partyUrl('https://example.com/app/', party)), { kind:'party', party });
  assert.equal(parseScan('https://example.com/#party=bad!'), null);
  assert.throws(() => encodeParty({ ...party, note: '<script>' }), /bad_party/);
  assert.throws(() => encodeParty({ ...party, name: 'javascript:alert(1)' }), /bad_party/);
  assert.throws(() => encodeParty({ ...party, extra: 'x'.repeat(1536) }), /bad_party/);
  assert.throws(() => decodeParty('bad!'), /bad_party/);
});

test('v2 joined party seals arrival, stamps met, tracks home reminder privately', async () => {
  const storage = makeStorage();
  const store = createStore(storage);
  const vault = await createVault('123456');
  store.setVault(vault);
  const arrivalAt = '2026-10-26T21:00:00.000Z';
  assert.equal(store.homeReminderDue('2026-10-27T03:00:00.000Z'), false);
  await store.joinParty(party, { now: arrivalAt, loc: { lat: 1 } });
  assert.deepEqual(store.getParty(), party);
  assert.equal(store.homeReminderDue('2026-10-27T02:00:00.000Z'), false);
  assert.equal(store.homeReminderDue('2026-10-27T03:00:00.000Z'), true);
  assert.equal(storage.getItem('hb_party_home'), 'false');
  assert.equal(storage.getItem('hb_log').includes(arrivalAt), false);
  assert.equal(storage.getItem('hb_log').includes('Autumn Night'), false);
  const privateKey = await unlock(vault, '123456');
  const arrival = await open(privateKey, store.listSealed()[0]);
  assert.deepEqual({type:arrival.type, at:arrival.at, partyId:arrival.partyId, name:arrival.name}, {type:'arrive',at:arrivalAt,partyId:'party1',name:'Autumn Night'});
  await store.recordScan({ card: { id:'person1', n:'Jordan' }, now:'2026-10-26T22:00:00.000Z' });
  assert.equal((await open(privateKey, store.listSealed()[1])).partyId, 'party1');
  await store.recordNote({ text:'Left by the back door', now:'2026-10-26T23:00:00.000Z' });
  assert.equal((await open(privateKey, store.listSealed()[2])).type, 'note');
  await store.recordHome({ now:'2026-10-27T03:00:00.000Z' });
  assert.equal(store.homeReminderDue('2026-10-27T04:00:00.000Z'), false);
  assert.equal(storage.getItem('hb_party_home'), 'true');
  store.leaveParty();
  assert.equal(store.homeReminderDue('2026-10-27T04:00:00.000Z'), false);
  assert.equal(store.getParty(), null);
  store.saveHosted(party); assert.equal(store.listHosted().length, 1);
  store.removeHosted(party.id); assert.equal(store.listHosted().length, 0);
  store.setShare({ ig:false, tt:true }); assert.equal(store.getShare().ig, false);
  store.wipe(); assert.equal([...storage.map.keys()].filter(k => k.startsWith('hb_')).length, 0);
});

test('v2 arrive recap includes parties and share text', () => {
  const entry = { type:'arrive', name:'Autumn Night', at:'2026-10-26T21:00:00.000Z' };
  assert.deepEqual(recap({entries:[entry]}).parties, ['Autumn Night']);
  assert.match(shareText({label:'Mon',entries:[entry]}), /Arrived at Autumn Night/);
});

test('v2 legacy four-digit vault unlocks and prompts migration', async () => {
  const pass = '1234';
  assert.equal(isLegacyPasscode(pass), true);
  assert.equal(isLegacyPasscode('12345'), true);
  assert.equal(isLegacyPasscode('123456'), false);
  await assert.rejects(createVault(pass), /bad_passcode_format/);
  const current = await createVault('123456');
  const privateKey = await unlock(current, '123456');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const wrapping = await crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:310000, hash:'SHA-256' }, keyMaterial, { name:'AES-GCM', length:256 }, false, ['wrapKey']);
  const wrapped = await crypto.subtle.wrapKey('pkcs8', privateKey, wrapping, { name:'AES-GCM', iv });
  const legacy = { ...current, salt:bytesToBase64Url(salt), wrapped:{ iv:bytesToBase64Url(iv), ct:bytesToBase64Url(wrapped) } };
  assert.ok(await unlock(legacy, pass));
  await assert.rejects(changePasscode(legacy, pass, '12345'), /bad_passcode_format/);
  const changed = await changePasscode(legacy, pass, '654321');
  assert.ok(await unlock(changed, '654321'));
});
