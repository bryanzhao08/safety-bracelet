// web/shared/qr.js - Self-contained zero-dependency QR code generator (ES Module)
// Generates clean SVG markup or canvas rendering for wristband tags and printable sheets.

// Galois Field GF(256) tables for Reed-Solomon coding
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = val;
    EXP[i + 255] = val;
    LOG[val] = i;
    val = (val << 1) ^ (val & 128 ? 0x11d : 0);
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return EXP[LOG[x] + LOG[y]];
}

// Error correction polynomials
function rsPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const poly = rsPoly(ecCount);
  const res = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const m = data[i] ^ res[0];
    for (let j = 0; j < ecCount - 1; j++) {
      res[j] = res[j + 1] ^ gfMul(poly[j + 1], m);
    }
    res[ecCount - 1] = gfMul(poly[ecCount], m);
  }
  return res;
}

// Version table for QR Model 2 (Versions 1 to 10, ECC Level M)
// [totalDataCodewords, ecCodewordsPerBlock, numBlocks]
const VERSIONS = [
  null,
  { version: 1, size: 21, dataWords: 16, ecPerBlock: 10, blocks: 1 },
  { version: 2, size: 25, dataWords: 28, ecPerBlock: 16, blocks: 1 },
  { version: 3, size: 29, dataWords: 44, ecPerBlock: 26, blocks: 1 },
  { version: 4, size: 33, dataWords: 64, ecPerBlock: 18, blocks: 2 },
  { version: 5, size: 37, dataWords: 86, ecPerBlock: 24, blocks: 2 },
  { version: 6, size: 41, dataWords: 108, ecPerBlock: 16, blocks: 4 },
  { version: 7, size: 45, dataWords: 124, ecPerBlock: 18, blocks: 4 },
  { version: 8, size: 49, dataWords: 154, ecPerBlock: 22, blocks: 4 },
  { version: 9, size: 53, dataWords: 182, ecPerBlock: 22, blocks: 5 },
  { version: 10, size: 57, dataWords: 216, ecPerBlock: 26, blocks: 5 },
];

// Alignment pattern locations by version
const ALIGNMENT_COORDS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function selectVersion(textLen) {
  // Byte mode header: 4 bits mode + 8 bits length (for ver 1-9) or 16 bits
  for (let v = 1; v <= 10; v++) {
    const info = VERSIONS[v];
    const capacity = info.dataWords - 2; // ~2 bytes overhead
    if (textLen <= capacity) return info;
  }
  return VERSIONS[10];
}

class BitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }
  put(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      this.buffer.push((val >>> i) & 1);
      this.length++;
    }
  }
  getBytes() {
    const bytes = new Uint8Array(Math.ceil(this.buffer.length / 8));
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i]) {
        bytes[i >>> 3] |= 0x80 >>> (i & 7);
      }
    }
    return bytes;
  }
}

/**
 * Encodes text into a boolean 2D matrix (true = dark, false = light).
 */
export function generateQRMatrix(text) {
  const enc = new TextEncoder().encode(text);
  const verInfo = selectVersion(enc.length);
  const size = verInfo.size;
  const version = verInfo.version;

  // Encode data in byte mode (mode 0100)
  const bb = new BitBuffer();
  bb.put(0b0100, 4); // Byte mode
  bb.put(enc.length, version < 10 ? 8 : 16);
  for (let i = 0; i < enc.length; i++) {
    bb.put(enc[i], 8);
  }

  // Terminator
  const totalDataBits = verInfo.dataWords * 8;
  const termLen = Math.min(4, totalDataBits - bb.length);
  if (termLen > 0) bb.put(0, termLen);

  // Align to 8-bit byte
  if (bb.length % 8 !== 0) {
    bb.put(0, 8 - (bb.length % 8));
  }

  // Pad bytes 0xEC, 0x11
  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (bb.length < totalDataBits) {
    bb.put(pads[padIdx], 8);
    padIdx = (padIdx + 1) % 2;
  }

  const dataBytes = bb.getBytes();

  // Split into blocks and calculate ECC
  const numBlocks = verInfo.blocks;
  const ecPerBlock = verInfo.ecPerBlock;
  const wordsPerBlock = Math.floor(verInfo.dataWords / numBlocks);
  const extraBlocks = verInfo.dataWords % numBlocks;

  const dataBlocks = [];
  const ecBlocks = [];
  let byteOffset = 0;

  for (let b = 0; b < numBlocks; b++) {
    const blockLen = wordsPerBlock + (b >= numBlocks - extraBlocks ? 1 : 0);
    const slice = dataBytes.slice(byteOffset, byteOffset + blockLen);
    dataBlocks.push(slice);
    ecBlocks.push(rsEncode(slice, ecPerBlock));
    byteOffset += blockLen;
  }

  // Interleave data and ec codewords
  const interleaved = [];
  const maxBlockLen = wordsPerBlock + (extraBlocks > 0 ? 1 : 0);
  for (let i = 0; i < maxBlockLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) {
        interleaved.push(dataBlocks[b][i]);
      }
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      interleaved.push(ecBlocks[b][i]);
    }
  }

  // Create matrix
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunction = Array.from({ length: size }, () => Array(size).fill(false));

  function setFunction(r, c, val) {
    matrix[r][c] = val;
    isFunction[r][c] = true;
  }

  // Finder patterns
  function placeFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r, mc = col + c;
        if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
        if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          setFunction(mr, mc, true);
        } else {
          setFunction(mr, mc, false);
        }
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) setFunction(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(i, 6, i % 2 === 0);
  }

  // Alignment patterns for version >= 2
  const coords = ALIGNMENT_COORDS[version] || [];
  for (const r of coords) {
    for (const c of coords) {
      if (isFunction[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isBlack = Math.max(Math.abs(dr), Math.abs(dc)) === 2 || (dr === 0 && dc === 0);
          setFunction(r + dr, c + dc, isBlack);
        }
      }
    }
  }

  // Dark module
  setFunction(4 * version + 9, 8, true);

  // Reserve format information areas
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) setFunction(8, i, false);
    if (!isFunction[i][8]) setFunction(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) setFunction(8, size - 1 - i, false);
    if (!isFunction[size - 1 - i][8]) setFunction(size - 1 - i, 8, false);
  }

  // Place data bits
  let bitIdx = 0;
  const totalBits = interleaved.length * 8;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const row = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!isFunction[row][col]) {
          let bit = false;
          if (bitIdx < totalBits) {
            const byte = interleaved[bitIdx >>> 3];
            bit = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Mask pattern 0: (row + col) % 2 === 0
          if ((row + col) % 2 === 0) {
            bit = !bit;
          }
          matrix[row][col] = bit;
        }
      }
    }
  }

  // Format bits: ECC level M (00) + mask 0 (000) => format code 101010000010010 (BCH code)
  // Mask pattern 0 with ECC M has standard format sequence 0x5412 ^ 0x5412 = 0, BCH encoded:
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  // Top-left format bits
  for (let i = 0; i <= 5; i++) matrix[8][i] = formatBits[i] === 1;
  matrix[8][7] = formatBits[6] === 1;
  matrix[8][8] = formatBits[7] === 1;
  matrix[7][8] = formatBits[8] === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i] === 1;

  // Split format bits across other edges
  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = formatBits[i] === 1;
  for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = formatBits[i] === 1;

  return matrix;
}

/**
 * Returns an SVG string of the QR code.
 */
export function generateQRSvg(text, { size = 180, margin = 2, color = '#000000', bgColor = '#ffffff' } = {}) {
  const matrix = generateQRMatrix(text);
  const n = matrix.length;
  const viewBoxSize = n + margin * 2;
  
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="${color}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" shape-rendering="crispEdges">
    <rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${bgColor}"/>
    ${rects}
  </svg>`;
}
