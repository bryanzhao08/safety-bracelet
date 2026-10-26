// Pure ES module base64url helpers
// Compatible with Node 24, Chrome, and Safari

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

export function bytesToBase64Url(bytes) {
  if (bytes instanceof ArrayBuffer) {
    bytes = new Uint8Array(bytes);
  }
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2] +
           B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
           B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] +
           B64_CHARS[b2 & 63];
  }
  if (i < len) {
    const b0 = bytes[i];
    if (i + 1 < len) {
      const b1 = bytes[i + 1];
      out += B64_CHARS[b0 >> 2] +
             B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
             B64_CHARS[(b1 & 15) << 2];
    } else {
      out += B64_CHARS[b0 >> 2] +
             B64_CHARS[(b0 & 3) << 4];
    }
  }
  return out;
}

export function base64UrlToBytes(str) {
  if (typeof str !== 'string') {
    throw new Error('invalid_base64');
  }
  let clean = str.replace(/=+$/, '');
  clean = clean.replace(/\+/g, '-').replace(/\//g, '_');
  const len = clean.length;
  if (!len) return new Uint8Array(0);

  for (let i = 0; i < len; i++) {
    const code = clean.charCodeAt(i);
    if (code > 255 || (clean[i] !== 'A' && B64_LOOKUP[code] === 0 && code !== 65)) {
      throw new Error('invalid_base64');
    }
  }

  const mod = len % 4;
  if (mod === 1) {
    throw new Error('invalid_base64');
  }
  const fullBlocks = Math.floor(len / 4);
  const rem = mod === 2 ? 1 : (mod === 3 ? 2 : 0);
  const out = new Uint8Array(fullBlocks * 3 + rem);

  let inIdx = 0;
  let outIdx = 0;
  for (let b = 0; b < fullBlocks; b++) {
    const c0 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    const c1 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    const c2 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    const c3 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
    out[outIdx++] = ((c2 & 3) << 6) | c3;
  }
  if (rem === 1) {
    const c0 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    const c1 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
  } else if (rem === 2) {
    const c0 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    const c1 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    const c2 = B64_LOOKUP[clean.charCodeAt(inIdx++)];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ToBase64Url(str) {
  return bytesToBase64Url(encoder.encode(str));
}

export function base64UrlToUtf8(str) {
  return decoder.decode(base64UrlToBytes(str));
}
