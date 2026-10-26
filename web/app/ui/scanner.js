// web/app/ui/scanner.js - Camera QR code scanner with BarcodeDetector and ZXing fallback
// Extended with facingMode option ('environment' for back camera, 'user' for front camera).

export class QrCameraScanner {
  constructor(videoElement, { onScan, onError, facingMode = 'environment' } = {}) {
    this.video = videoElement;
    this.onScan = onScan;
    this.onError = onError;
    this.facingMode = facingMode;
    this.stream = null;
    this.animationFrame = null;
    this.active = false;
    this.detector = null;
    this.zxingReader = null;
    this.lastScanned = null;
    this.lastScanTime = 0;
    this.lastZxingAttempt = 0;
  }

  static isSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start(facingMode) {
    if (facingMode) {
      this.facingMode = facingMode;
    }
    if (this.active) {
      this.stop();
    }

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

      if (!this.detector && typeof window !== 'undefined' && window.ZXing?.BrowserQRCodeReader) {
        try {
          this.zxingReader = new window.ZXing.BrowserQRCodeReader();
        } catch (e) {
          console.warn('ZXing reader init failed:', e);
        }
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'true');
      this.video.setAttribute('muted', 'true');
      await this.video.play();
      this.active = true;
      this.scanLoop();
    } catch (err) {
      this.active = false;
      this.onError?.(err);
      throw err;
    }
  }

  async scanLoop() {
    if (!this.active) return;

    if (this.video && this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      if (this.detector) {
        try {
          const barcodes = await this.detector.detect(this.video);
          if (barcodes && barcodes.length > 0) {
            const text = barcodes[0].rawValue;
            if (text) {
              this.handleDetected(text);
            }
          }
        } catch (err) {
          // Ignore frame decode errors
        }
      } else if (this.zxingReader) {
        const now = performance.now();
        if (now - this.lastZxingAttempt >= 120) {
          this.lastZxingAttempt = now;
          try {
            const result = this.zxingReader.decode(this.video);
            if (result) {
              const text = result.getText ? result.getText() : result.text;
              if (text) {
                this.handleDetected(text);
              }
            }
          } catch (err) {
            // ZXing throws NotFoundException when frame contains no QR; ignore
          }
        }
      }
    }

    if (this.active) {
      this.animationFrame = requestAnimationFrame(() => this.scanLoop());
    }
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
        try {
          track.stop();
        } catch {}
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }
}
