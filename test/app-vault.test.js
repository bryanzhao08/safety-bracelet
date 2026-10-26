import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault,
  seal,
  unlock,
  open,
  changePasscode
} from '../web/app/lib/vault.js';

test('vault: create -> seal -> unlock -> open round trip', async () => {
  const passcode = '123456';
  const meta = await createVault(passcode);

  assert.equal(meta.v, 1);
  assert.ok(meta.salt);
  assert.equal(meta.iter, 310000);
  assert.ok(meta.pub);
  assert.ok(meta.wrapped.iv);
  assert.ok(meta.wrapped.ct);

  const entry = {
    id: 'entry1',
    type: 'met',
    at: '2026-10-24T22:30:00.000Z',
    personId: 'p123456789',
    name: 'Maya'
  };

  const sealed = await seal(meta, entry);
  assert.ok(sealed.epk);
  assert.ok(sealed.iv);
  assert.ok(sealed.ct);

  const privKey = await unlock(meta, passcode);
  assert.ok(privKey);

  const decrypted = await open(privKey, sealed);
  assert.deepEqual(decrypted, entry);
});

test('vault: wrong passcode throws bad_passcode', async () => {
  const meta = await createVault('123456');
  await assert.rejects(
    async () => unlock(meta, '9999'),
    /bad_passcode/
  );
});

test('vault: sealing works with only meta (no passcode needed)', async () => {
  const meta = await createVault('456789');
  // Passcode is not known or needed to seal
  const entry = {
    id: 'e2',
    type: 'note',
    at: '2026-10-24T23:15:00.000Z',
    text: 'Met Jordan at the porch'
  };

  const sealed = await seal(meta, entry);
  assert.ok(sealed.epk);
  assert.ok(sealed.iv);
  assert.ok(sealed.ct);

  const privKey = await unlock(meta, '456789');
  const decrypted = await open(privKey, sealed);
  assert.deepEqual(decrypted, entry);
});

test('vault: changePasscode old entries still open, and old passcode fails', async () => {
  const oldPass = '111111';
  const newPass = '222222';
  const meta = await createVault(oldPass);

  const entry = { id: 'e3', type: 'home', at: '2026-10-25T02:00:00.000Z' };
  const sealed = await seal(meta, entry);

  const newMeta = await changePasscode(meta, oldPass, newPass);

  // Old passcode fails on new meta
  await assert.rejects(
    async () => unlock(newMeta, oldPass),
    /bad_passcode/
  );

  // New passcode unlocks
  const newPrivKey = await unlock(newMeta, newPass);

  // Old entry still opens!
  const decrypted = await open(newPrivKey, sealed);
  assert.deepEqual(decrypted, entry);
});

test('vault: format check on passcode (6-8 digits for creation)', async () => {
  // Creation requires 6–8 digits; unlock retains support for legacy 4–5 digits.
  const invalidPasscodes = ['', '123', '1234', '12345', '123456789', 'abcd', '12a4', '12 34'];
  for (const p of invalidPasscodes) {
    await assert.rejects(
      async () => createVault(p),
      /bad_passcode_format/
    );
  }

  const meta = await createVault('123456');
  for (const p of invalidPasscodes.filter(p => !/^\d{4,5}$/.test(p))) {
    await assert.rejects(
      async () => unlock(meta, p),
      /bad_passcode_format/
    );
    await assert.rejects(
      async () => changePasscode(meta, '123456', p),
      /bad_passcode_format/
    );
  }
  for (const p of ['1234', '12345']) {
    await assert.rejects(changePasscode(meta, '123456', p), /bad_passcode_format/);
  }
});

test('vault: two seals of the same entry give different ciphertext', async () => {
  const meta = await createVault('987654');
  const entry = { id: 'e_same', type: 'met', at: '2026-10-24T20:00:00.000Z', name: 'Sam' };

  const seal1 = await seal(meta, entry);
  const seal2 = await seal(meta, entry);

  assert.notEqual(seal1.ct, seal2.ct);
  assert.notEqual(seal1.iv, seal2.iv);

  const priv = await unlock(meta, '987654');
  assert.deepEqual(await open(priv, seal1), entry);
  assert.deepEqual(await open(priv, seal2), entry);
});
