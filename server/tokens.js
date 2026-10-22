import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const BAND_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 128 bits of unpredictable entropy, encoded as 32 lowercase hex digits. */
export function randomToken() {
  return randomBytes(16).toString('hex');
}

/** Four printable characters, avoiding 0/O and 1/I/L. */
export function shortCode() {
  return Array.from({ length: 4 }, () => BAND_ALPHABET[randomInt(BAND_ALPHABET.length)]).join('');
}

/** Compare secrets without returning early on a matching prefix. */
export function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Keep the unequal-length path independent of the first differing byte.
    timingSafeEqual(left, Buffer.alloc(left.length));
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Store a salted, memory-hard digest rather than an eight-digit PIN. */
export function hashPin(pin) {
  const salt = randomBytes(16);
  const digest = scryptSync(String(pin), salt, 32);
  return `scrypt:${salt.toString('hex')}:${digest.toString('hex')}`;
}

export function verifyPin(pin, encoded) {
  if (typeof encoded !== 'string') return false;
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[0-9a-f]{32}$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return false;
  const digest = scryptSync(String(pin), Buffer.from(parts[1], 'hex'), 32);
  return timingSafeEqual(digest, Buffer.from(parts[2], 'hex'));
}
