import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newId,
  encodeCard,
  decodeCard,
  cardUrl,
  parseScan,
  vcard
} from '../web/app/lib/card.js';

test('card: round trip with full card', () => {
  const card = {
    v: 1,
    id: newId(),
    n: 'Maya Lin',
    p: '+1 (555) 123-4567',
    ig: 'maya.lin',
    sc: 'mayalin_snap',
    e: 'maya@example.com'
  };

  const encoded = encodeCard(card);
  const decoded = decodeCard(encoded);

  assert.equal(decoded.v, 1);
  assert.equal(decoded.id, card.id);
  assert.equal(decoded.n, card.n);
  assert.equal(decoded.p, card.p);
  assert.equal(decoded.ig, card.ig);
  assert.equal(decoded.sc, card.sc);
  assert.equal(decoded.e, card.e);
});

test('card: optional keys omitted when empty or missing', () => {
  const minimal = {
    id: newId(),
    n: 'Jordan'
  };
  const encoded = encodeCard(minimal);
  const decoded = decodeCard(encoded);

  assert.equal(decoded.v, 1);
  assert.equal(decoded.id, minimal.id);
  assert.equal(decoded.n, 'Jordan');
  assert.equal(decoded.p, undefined);
  assert.equal(decoded.ig, undefined);
  assert.equal(decoded.sc, undefined);
  assert.equal(decoded.e, undefined);

  // Also when passed as empty strings
  const emptyFields = {
    id: newId(),
    n: 'Jordan',
    p: '',
    ig: '',
    sc: '',
    e: ''
  };
  const decoded2 = decodeCard(encodeCard(emptyFields));
  assert.equal(decoded2.p, undefined);
  assert.equal(decoded2.ig, undefined);
  assert.equal(decoded2.sc, undefined);
  assert.equal(decoded2.e, undefined);
});

test('card: every invalid field throws bad_card', () => {
  const base = { id: newId(), n: 'Alex' };

  // Empty or missing name
  assert.throws(() => decodeCard(JSON.stringify({ ...base, n: '' })), /bad_card/);
  assert.throws(() => decodeCard(JSON.stringify({ id: newId() })), /bad_card/);
  assert.throws(() => decodeCard(JSON.stringify({ ...base, n: '   ' })), /bad_card/);
  // Name too long (> 40 chars)
  assert.throws(() => decodeCard(JSON.stringify({ ...base, n: 'A'.repeat(41) })), /bad_card/);

  // Missing or empty id
  assert.throws(() => decodeCard(JSON.stringify({ n: 'Alex' })), /bad_card/);
  assert.throws(() => decodeCard(JSON.stringify({ id: '', n: 'Alex' })), /bad_card/);

  // Invalid phone number
  assert.throws(() => decodeCard(JSON.stringify({ ...base, p: '123' })), /bad_card/); // too short (<7)
  assert.throws(() => decodeCard(JSON.stringify({ ...base, p: 'phone number with letters' })), /bad_card/);

  // Invalid instagram handle
  assert.throws(() => decodeCard(JSON.stringify({ ...base, ig: 'user with spaces' })), /bad_card/);
  assert.throws(() => decodeCard(JSON.stringify({ ...base, ig: 'x'.repeat(31) })), /bad_card/);

  // Invalid snapchat handle
  assert.throws(() => decodeCard(JSON.stringify({ ...base, sc: 'bad#snap' })), /bad_card/);

  // Invalid email
  assert.throws(() => decodeCard(JSON.stringify({ ...base, e: 'notanemail' })), /bad_card/);
  assert.throws(() => decodeCard(JSON.stringify({ ...base, e: 'user@' })), /bad_card/);
  assert.throws(() => decodeCard(JSON.stringify({ ...base, e: '@domain.com' })), /bad_card/);

  // Invalid version
  assert.throws(() => decodeCard(JSON.stringify({ ...base, v: 2 })), /bad_card/);
});

test('card: unknown keys dropped', () => {
  const raw = {
    v: 1,
    id: newId(),
    n: 'Sam',
    unknownField: 'dropped',
    admin: true,
    location: { lat: 37.7 }
  };
  const encoded = encodeCard(raw);
  const decoded = decodeCard(encoded);

  assert.equal(decoded.n, 'Sam');
  assert.equal(decoded.unknownField, undefined);
  assert.equal(decoded.admin, undefined);
  assert.equal(decoded.location, undefined);
});

test('card: parseScan handles full URL, bare value, and garbage', () => {
  const card = { id: newId(), n: 'Maya', p: '+15551234567' };
  const encoded = encodeCard(card);

  // Full URL with #add=
  const url = `https://homebound.app/app/#add=${encoded}`;
  const parsedFromUrl = parseScan(url);
  assert.ok(parsedFromUrl);
  assert.equal(parsedFromUrl.card.id, card.id);
  assert.equal(parsedFromUrl.card.n, card.n);
  assert.equal(parsedFromUrl.card.p, card.p);

  // Full URL with extra query params or fragment
  const urlWithParams = `https://homebound.app/app/?ref=cam#add=${encoded}`;
  const parsedFromParams = parseScan(urlWithParams);
  assert.ok(parsedFromParams);
  assert.equal(parsedFromParams.card.n, card.n);

  // Bare base64url value
  const parsedFromBare = parseScan(encoded);
  assert.ok(parsedFromBare);
  assert.equal(parsedFromBare.card.id, card.id);
  assert.equal(parsedFromBare.card.n, card.n);

  // Garbage returns null
  assert.equal(parseScan(''), null);
  assert.equal(parseScan('garbage-not-valid-base64!@#$'), null);
  assert.equal(parseScan('https://google.com'), null);
  assert.equal(parseScan(null), null);
  assert.equal(parseScan(undefined), null);
});

test('card: encoded URL under 300 chars for a maximal card', () => {
  const maxCard = {
    v: 1,
    id: '0123456789',
    n: 'Maya Alexandria Katherine Montgomery IV', // 39 chars
    p: '+1 (555) 123-4567',
    ig: 'maya.alexandria.montgomery',
    sc: 'maya_snap2026',
    e: 'maya.montgomery@alumni.stanford.edu'
  };

  const base = 'https://homebound.app/app/';
  const url = cardUrl(base, maxCard);
  assert.ok(url.length < 300, `Maximal card URL length was ${url.length}, expected < 300`);
});

test('card: vCard contains FN and TEL', () => {
  const card = {
    id: newId(),
    n: 'Jordan Rivers',
    p: '+15551234567',
    e: 'jordan@example.com',
    ig: 'jordan.r'
  };

  const vc = vcard(card);
  assert.match(vc, /^BEGIN:VCARD/m);
  assert.match(vc, /FN:Jordan Rivers/);
  assert.match(vc, /TEL.*:\+15551234567/);
  assert.match(vc, /EMAIL:jordan@example.com/);
  assert.match(vc, /END:VCARD/m);
});
