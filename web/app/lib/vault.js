import { bytesToBase64Url, base64UrlToBytes } from './b64.js';

function assertPasscodeFormat(passcode, legacy = false) {
  if (typeof passcode !== 'string' || !(legacy ? /^\d{4,8}$/ : /^\d{6,8}$/).test(passcode)) {
    throw new Error('bad_passcode_format');
  }
}

export function isLegacyPasscode(passcode) {
  return typeof passcode === 'string' && /^\d{4,5}$/.test(passcode);
}

async function deriveWrappingKey(passcode, saltBytes, iter = 310000) {
  const enc = new TextEncoder();
  const passKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iter,
      hash: 'SHA-256'
    },
    passKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

export async function createVault(passcode) {
  assertPasscodeFormat(passcode);

  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const pub = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);

  const ivBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(ivBytes);

  const wrappingKey = await deriveWrappingKey(passcode, saltBytes, 310000);
  const wrappedBytes = await globalThis.crypto.subtle.wrapKey(
    'pkcs8',
    keyPair.privateKey,
    wrappingKey,
    { name: 'AES-GCM', iv: ivBytes }
  );

  return {
    v: 1,
    salt: bytesToBase64Url(saltBytes),
    iter: 310000,
    pub,
    wrapped: {
      iv: bytesToBase64Url(ivBytes),
      ct: bytesToBase64Url(wrappedBytes)
    }
  };
}

export async function seal(meta, entry) {
  if (!meta || !meta.pub) {
    throw new Error('invalid_vault_meta');
  }

  const vaultPubKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    meta.pub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const ephemKeyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const epk = await globalThis.crypto.subtle.exportKey('jwk', ephemKeyPair.publicKey);

  const aesKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: vaultPubKey
    },
    ephemKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const ivBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(ivBytes);

  const plaintext = new TextEncoder().encode(JSON.stringify(entry));
  const ctBytes = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    plaintext
  );

  return {
    epk,
    iv: bytesToBase64Url(ivBytes),
    ct: bytesToBase64Url(ctBytes)
  };
}

export async function unlock(meta, passcode) {
  assertPasscodeFormat(passcode, true);
  if (!meta || !meta.salt || !meta.wrapped || !meta.wrapped.iv || !meta.wrapped.ct) {
    throw new Error('bad_passcode');
  }
  if (typeof meta.iter !== 'number' || meta.iter < 310000) {
    throw new Error('bad_passcode');
  }

  try {
    const saltBytes = base64UrlToBytes(meta.salt);
    const ivBytes = base64UrlToBytes(meta.wrapped.iv);
    const ctBytes = base64UrlToBytes(meta.wrapped.ct);
    const iter = meta.iter || 310000;

    const wrappingKey = await deriveWrappingKey(passcode, saltBytes, iter);

    const privKey = await globalThis.crypto.subtle.unwrapKey(
      'pkcs8',
      ctBytes,
      wrappingKey,
      { name: 'AES-GCM', iv: ivBytes },
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    return privKey;
  } catch (err) {
    if (err.message === 'bad_passcode_format') throw err;
    throw new Error('bad_passcode');
  }
}

export async function open(privKey, sealed) {
  if (!privKey || !sealed || !sealed.epk || !sealed.iv || !sealed.ct) {
    throw new Error('corrupt');
  }

  try {
    const epkKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      sealed.epk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    const aesKey = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: epkKey
      },
      privKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const ivBytes = base64UrlToBytes(sealed.iv);
    const ctBytes = base64UrlToBytes(sealed.ct);
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      ctBytes
    );

    const json = new TextDecoder().decode(decrypted);
    return JSON.parse(json);
  } catch {
    throw new Error('corrupt');
  }
}

export async function changePasscode(meta, oldPass, newPass) {
  assertPasscodeFormat(newPass);
  const privKey = await unlock(meta, oldPass);

  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);

  const ivBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(ivBytes);

  const newWrappingKey = await deriveWrappingKey(newPass, saltBytes, 310000);
  const wrappedBytes = await globalThis.crypto.subtle.wrapKey(
    'pkcs8',
    privKey,
    newWrappingKey,
    { name: 'AES-GCM', iv: ivBytes }
  );

  return {
    v: 1,
    salt: bytesToBase64Url(saltBytes),
    iter: 310000,
    pub: meta.pub,
    wrapped: {
      iv: bytesToBase64Url(ivBytes),
      ct: bytesToBase64Url(wrappedBytes)
    }
  };
}
