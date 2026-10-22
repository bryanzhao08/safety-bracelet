// web/shared/aamva.js - Parser for AAMVA PDF417 driver license barcodes

/**
 * Normalizes an 8-digit date string into YYYY-MM-DD format.
 * Supports MMDDYYYY (standard US) and YYYYMMDD (Canada / ISO / some states).
 */
export function normalizeDate(str) {
  if (!str) return null;
  const digits = str.replace(/\D/g, '');
  if (digits.length !== 8) return null;

  let yyyy, mm, dd;

  // Check if YYYYMMDD (starts with 19xx or 20xx)
  const first4 = parseInt(digits.slice(0, 4), 10);
  const last4 = parseInt(digits.slice(4, 8), 10);

  if (first4 >= 1900 && first4 <= 2099) {
    yyyy = digits.slice(0, 4);
    mm = digits.slice(4, 6);
    dd = digits.slice(6, 8);
  } else if (last4 >= 1900 && last4 <= 2099) {
    mm = digits.slice(0, 2);
    dd = digits.slice(2, 4);
    yyyy = digits.slice(4, 8);
  } else {
    return null;
  }

  const mNum = parseInt(mm, 10);
  const dNum = parseInt(dd, 10);
  if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31) return null;

  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * Parses raw barcode text from an AAMVA PDF417 barcode.
 * Returns: { firstName, lastName, dob, idState, idExpires, licenseNumber }
 */
export function parseAamva(raw) {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const fields = {};

  // Strip subfile header designator (DL or ID followed by 2-letter subfile code) if present
  // AAMVA records often have lines or segments starting with field codes.
  // We can scan for known AAMVA 3-letter codes:
  // DCS, DAB, DAC, DAD, DCT, DBB, DBA, DAJ, DAQ, etc.
  const knownCodes = ['DCS', 'DAB', 'DAC', 'DAD', 'DCT', 'DBB', 'DBA', 'DAJ', 'DAQ', 'DCF', 'DCG', 'DDE'];
  
  // Find all occurrences of known codes preceded by delimiter, subfile header (DL/ID), or line start
  const pattern = new RegExp(`(?:^|[\\r\\n\\x1e\\x1c\\x00-\\x1f]|DL|ID)(${knownCodes.join('|')})([^\\r\\n\\x1e\\x1c\\x00-\\x1f]+)`, 'g');
  
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const code = match[1];
    const val = match[2].trim();
    if (!fields[code]) {
      fields[code] = val;
    }
  }

  // Also check standard line-by-line fallback
  const lines = raw.split(/[\r\n]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    for (const code of knownCodes) {
      if (!fields[code]) {
        // e.g. "DACALICE" or "DLDAQD123"
        const prefixIdx = trimmed.indexOf(code);
        if (prefixIdx !== -1 && prefixIdx <= 4) {
          const val = trimmed.slice(prefixIdx + 3).trim();
          if (val) fields[code] = val;
        }
      }
    }
  }

  // Extract Last Name: DCS (modern) -> DAB (older) -> DCT (combined)
  let lastName = fields.DCS || fields.DAB || '';
  // Extract First Name: DAC (modern) -> DCT (combined)
  let firstName = fields.DAC || '';

  // Handle combined name field DCT if DAC or DCS is missing
  if ((!lastName || !firstName) && fields.DCT) {
    const combined = fields.DCT.trim();
    if (combined.includes(',')) {
      const parts = combined.split(',').map(p => p.trim());
      if (!lastName && parts[0]) lastName = parts[0];
      if (!firstName && parts[1]) firstName = parts[1];
    } else {
      const parts = combined.split(/\s+/);
      if (parts.length >= 2) {
        if (!firstName) firstName = parts[0];
        if (!lastName) lastName = parts.slice(1).join(' ');
      }
    }
  }

  // Clean trailing spaces or commas, and any non-printable control characters
  lastName = lastName.replace(/[\x00-\x1f\x7f]/g, '').replace(/[,;]+$/, '').trim();
  firstName = firstName.replace(/[\x00-\x1f\x7f]/g, '').replace(/[,;]+$/, '').trim();

  // Date of Birth: DBB
  const dob = normalizeDate(fields.DBB);

  // Document Expiration: DBA
  const idExpires = normalizeDate(fields.DBA);

  // Jurisdiction / State: DAJ
  const idState = (fields.DAJ || '').replace(/[\x00-\x1f\x7f]/g, '').trim().toUpperCase().slice(0, 2);

  // License Number: DAQ
  const licenseNumber = (fields.DAQ || '').replace(/[\x00-\x1f\x7f]/g, '').trim();

  if (!firstName && !lastName && !dob && !licenseNumber) {
    return null;
  }

  return {
    firstName: firstName || null,
    lastName: lastName || null,
    dob: dob || null,
    idState: idState || null,
    idExpires: idExpires || null,
    licenseNumber: licenseNumber || null,
  };
}
