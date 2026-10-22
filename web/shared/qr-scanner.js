// web/shared/qr-scanner.js - Camera QR code scanner with BarcodeDetector and fallback
export class QrCameraScanner {
  constructor(videoElement, { onScan, onError }) {
    this.video = videoElement;
    this.onScan = onScan;
    this.onError = onError;
    this.stream = null;
    this.animationFrame = null;
    this.active = false;
    this.detector = null;
    this.lastScanned = null;
    this.lastScanTime = 0;
  }

  static isSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start() {
    if (this.active) return;
    try {
      if ('BarcodeDetector' in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.includes('qr_code')) {
            this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch (e) {
          console.warn('BarcodeDetector format check failed:', e);
        }
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'true');
      await this.video.play();
      this.active = true;
      this.scanLoop();
    } catch (err) {
      this.active = false;
      this.onError?.(err);
      throw err;
    }
  }

  scanLoop() {
    if (!this.active) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      if (this.detector) {
        this.detector.detect(this.video)
          .then(barcodes => {
            if (barcodes && barcodes.length > 0) {
              const text = barcodes[0].rawValue;
              this.handleDetected(text);
            }
          })
          .catch(err => {
            // Ignore frame decode errors
          });
      }
    }

    this.animationFrame = requestAnimationFrame(() => this.scanLoop());
  }

  handleDetected(text) {
    const now = Date.now();
    // Throttle duplicate reads of the exact same code within 2 seconds
    if (text === this.lastScanned && now - this.lastScanTime < 2000) {
      return;
    }
    this.lastScanned = text;
    this.lastScanTime = now;
    this.onScan?.(text);
  }

  stop() {
    this.active = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }
}

/**
 * Extracts band token or short code from scanned QR string or NDEF text.
 * URLs look like: https://hostname/t/<token> or simply a 4-char code.
 */
export function parseScannedValue(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // Match /t/:token URL pattern
  const urlMatch = trimmed.match(/\/t\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    return { bandToken: urlMatch[1] };
  }

  // Match standard URL with full path
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 2] === 't') {
      return { bandToken: parts[parts.length - 1] };
    }
  } catch {
    // Not a URL
  }

  // 4-character alphanumeric short code
  if (/^[a-zA-Z0-9]{4}$/.test(trimmed)) {
    return { shortCode: trimmed.toUpperCase() };
  }

  // Fallback: if hex token
  if (/^[a-fA-F0-9]{16,64}$/.test(trimmed)) {
    return { bandToken: trimmed };
  }

  return { raw: trimmed };
}
