// web/shared/aamva.test.js - Test execution runner for aamva.test.html
import { parseAamva } from './aamva.js';

const SAMPLES = [
  {
    title: 'Sample 1: Modern US (California) - MMDDYYYY format',
    raw: '@\n\x1e\rANSI 6360000102DL00390198DLDAQD1234567\nDCSSMITH\nDACALICE\nDADJANE\nDBB04151995\nDBA04152028\nDAJCA\n',
    expected: {
      firstName: 'ALICE',
      lastName: 'SMITH',
      dob: '1995-04-15',
      idState: 'CA',
      idExpires: '2028-04-15',
      licenseNumber: 'D1234567',
    },
  },
  {
    title: 'Sample 2: Canada / ISO (Ontario) - YYYYMMDD format',
    raw: '@\n\x1e\rANSI 6360150102DL00390198DLDAQA98765432101\nDCSTREMBLAY\nDACJEAN\nDBB19900822\nDBA20270822\nDAJON\n',
    expected: {
      firstName: 'JEAN',
      lastName: 'TREMBLAY',
      dob: '1990-08-22',
      idState: 'ON',
      idExpires: '2027-08-22',
      licenseNumber: 'A98765432101',
    },
  },
  {
    title: 'Sample 3: Older AAMVA format (New York) - DAB surname field',
    raw: '@\n\x1e\rAAMVA 6360000102DL00390198DLDABJOHNSON\nDACROBERT\nDBB12012000\nDBA12012026\nDAJNY\nDAQ987654321\n',
    expected: {
      firstName: 'ROBERT',
      lastName: 'JOHNSON',
      dob: '2000-12-01',
      idState: 'NY',
      idExpires: '2026-12-01',
      licenseNumber: '987654321',
    },
  },
  {
    title: 'Sample 4: Combined name field DCT (Texas)',
    raw: '@\n\x1e\rAAMVA 6360000102DL00390198DLDCTWILLIAMS,SARAH,ANN\nDBB03102005\nDBA03102029\nDAJTX\nDAQ11223344\n',
    expected: {
      firstName: 'SARAH',
      lastName: 'WILLIAMS',
      dob: '2005-03-10',
      idState: 'TX',
      idExpires: '2029-03-10',
      licenseNumber: '11223344',
    },
  },
];

const container = document.getElementById('results');

SAMPLES.forEach((sample) => {
  const result = parseAamva(sample.raw);
  const passed = JSON.stringify(result) === JSON.stringify(sample.expected);

  const card = document.createElement('div');
  card.className = 'sample-card';
  card.innerHTML = `
    <div class="sample-header">
      <h3>${sample.title}</h3>
      <span class="badge ${passed ? 'badge-green' : 'badge-amber'}">
        ${passed ? '✓ PASSED' : '✕ FAILED'}
      </span>
    </div>
    <div class="sample-meta">Parsed output:</div>
    <pre class="sample-code"><code>${JSON.stringify(result, null, 2)}</code></pre>
  `;
  container.appendChild(card);
});
