import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';

function createSheetFakes() {
  class FakeSheet {
    constructor(name) {
      this.name = name;
      this.rows = [];
    }

    appendRow(row) {
      this.rows.push([...row]);
    }

    getDataRange() {
      return {
        getValues: () => this.rows.map(r => [...r]),
      };
    }

    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        setValue: (val) => {
          if (!this.rows[row - 1]) this.rows[row - 1] = [];
          this.rows[row - 1][col - 1] = val;
        },
        setFontWeight: () => {},
        getValues: () => {
          const res = [];
          for (let r = 0; r < numRows; r++) {
            const rowArr = [];
            for (let c = 0; c < numCols; c++) {
              rowArr.push(this.rows[row - 1 + r]?.[col - 1 + c] ?? '');
            }
            res.push(rowArr);
          }
          return res;
        },
      };
    }

    deleteRows(startRow, count) {
      this.rows.splice(startRow - 1, count);
    }

    getLastRow() {
      return this.rows.length;
    }

    getLastColumn() {
      return this.rows[0] ? this.rows[0].length : 0;
    }

    setFrozenRows() {}
  }

  const sheetsMap = new Map();

  const fakeSpreadsheet = {
    getSheetByName(name) {
      return sheetsMap.get(name) || null;
    },
    insertSheet(name) {
      const sheet = new FakeSheet(name);
      sheetsMap.set(name, sheet);
      return sheet;
    },
    deleteSheet(sheet) {
      sheetsMap.delete(sheet.name);
    },
    getSheets() {
      return Array.from(sheetsMap.values());
    },
  };

  const fakeCache = new Map();

  const context = {
    console,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Set,
    Map,
    RegExp,
    parseInt,
    parseFloat,

    SpreadsheetApp: {
      getActiveSpreadsheet: () => fakeSpreadsheet,
      getUi: () => ({
        alert: () => {},
        createMenu: () => ({
          addItem: () => ({
            addItem: () => ({
              addToUi: () => {},
            }),
          }),
        }),
      }),
    },

    Utilities: {
      computeHmacSha256Signature(value, key) {
        const hmac = createHmac('sha256', Buffer.from(key, 'utf8'));
        hmac.update(Buffer.from(value, 'utf8'));
        const digest = hmac.digest();
        return Array.from(digest).map(b => (b > 127 ? b - 256 : b));
      },
    },

    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        tryLock: () => true,
        releaseLock: () => {},
      }),
    },

    CacheService: {
      getScriptCache: () => ({
        get: (key) => fakeCache.get(key) || null,
        put: (key, val) => fakeCache.set(key, String(val)),
        remove: (key) => fakeCache.delete(key),
      }),
    },

    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(text) {
        return {
          text,
          mime: 'TEXT',
          setMimeType(m) {
            this.mime = m;
            return this;
          },
          getContent() {
            return this.text;
          },
        };
      },
    },

    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: (fn) => ({
        timeBased: () => ({
          everyDays: () => ({
            create: () => ({ getHandlerFunction: () => fn }),
          }),
        }),
      }),
    },
  };

  vm.createContext(context);
  const code = readFileSync(join(process.cwd(), 'sheets/Code.gs'), 'utf8');
  vm.runInContext(code, context);

  return { context, sheetsMap };
}

test('Google Sheets backend: setup -> importCsv -> monitorSession -> idCheckin -> scan in -> departures -> dashboard', async () => {
  const { context, sheetsMap } = createSheetFakes();

  const callDoPost = (payload) => {
    const res = context.doPost({
      postData: { contents: JSON.stringify(payload) },
    });
    return JSON.parse(res.getContent());
  };

  // 1. Run setup()
  const setupResult = context.setup();
  assert.equal(setupResult.ok, true, 'setup() must succeed');
  assert.ok(setupResult.adminPin, 'adminPin must be generated');
  assert.ok(setupResult.monitorCode, 'monitorCode must be generated');

  const { adminPin, monitorCode } = setupResult;

  // Verify created tabs
  assert.ok(sheetsMap.has('Guests'), 'Guests tab created');
  assert.ok(sheetsMap.has('Bands'), 'Bands tab created');
  assert.ok(sheetsMap.has('Scans'), 'Scans tab created');
  assert.ok(sheetsMap.has('Departures'), 'Departures tab created');
  assert.ok(sheetsMap.has('Audit'), 'Audit tab created');
  assert.ok(sheetsMap.has('Settings'), 'Settings tab created');

  // Verify ping
  const pingRes = callDoPost({ action: 'ping' });
  assert.equal(pingRes.ok, true);

  // 2. Import CSV from samples/luma_guests.csv
  const csvContent = readFileSync(join(process.cwd(), 'samples/luma_guests.csv'), 'utf8');
  const importRes = callDoPost({
    action: 'importCsv',
    auth: { adminPin },
    csvContent,
  });
  assert.ok(importRes.imported > 0, `Expected imported > 0, got ${importRes.imported}`);

  // Create bands
  const bandsRes = callDoPost({
    action: 'createBands',
    auth: { adminPin },
    count: 5,
  });
  assert.equal(bandsRes.bands.length, 5, 'Should create 5 bands');
  const band1 = bandsRes.bands[0];
  const band2 = bandsRes.bands[1];
  assert.ok(band1.url.includes('/t/?b='), 'Band URL should match /t/?b=<token>');

  // 3. Join monitor session
  const monRes = callDoPost({
    action: 'monitorSession',
    monitorCode,
    name: 'Door Monitor 1',
  });
  assert.ok(monRes.monitorToken, 'Monitor token must be returned');
  const monitorToken = monRes.monitorToken;

  // Search guests - verify NO email or phone is returned
  const searchRes = callDoPost({
    action: 'searchGuests',
    auth: { monitorToken },
    q: '',
  });
  assert.ok(Array.isArray(searchRes), 'Search result should be array');
  assert.ok(searchRes.length > 0, 'Should find guests');
  for (const g of searchRes) {
    assert.equal(g.email, undefined, 'Monitor search must never expose email');
    assert.equal(g.phone, undefined, 'Monitor search must never expose phone');
  }

  // Pick first guest from search for band 2
  const guest2 = searchRes[0];

  // 4. ID check-in with a new guest
  const rawLicense = 'D9876543';
  const idCheckinRes = callDoPost({
    action: 'idCheckin',
    auth: { monitorToken },
    firstName: 'Elena',
    lastName: 'Rostova',
    dob: '2001-04-15',
    idState: 'NY',
    idExpires: '2028-10-10',
    licenseNumber: rawLicense,
  });

  assert.equal(idCheckinRes.over21, true, 'Guest born in 2001 should be over 21');
  assert.equal(idCheckinRes.expired, false, 'ID expiring in 2028 should not be expired');
  assert.ok(idCheckinRes.guest, 'Guest should be created/matched');
  assert.equal(idCheckinRes.created, true, 'New walk-in guest created from ID');

  const guest1 = idCheckinRes.guest;

  // Verify ID Checkin response privacy
  assert.equal(idCheckinRes.licenseNumber, undefined, 'License number must not be returned');
  assert.equal(JSON.stringify(idCheckinRes).includes(rawLicense), false, 'Raw license must never appear in response');

  // Verify duplicate ID scan detection
  const dupCheckin = callDoPost({
    action: 'idCheckin',
    auth: { monitorToken },
    firstName: 'Elena',
    lastName: 'Rostova',
    dob: '2001-04-15',
    idState: 'NY',
    idExpires: '2028-10-10',
    licenseNumber: rawLicense,
  });
  assert.ok(dupCheckin.duplicate, 'Duplicate ID should be reported');
  assert.equal(dupCheckin.duplicate.guestId, guest1.id);

  // 5. Scan in band 1 for guest 1
  const scan1 = callDoPost({
    action: 'scan',
    auth: { monitorToken },
    shortCode: band1.shortCode,
    direction: 'in',
    guestId: guest1.id,
  });
  assert.equal(scan1.inside, true, 'Band 1 should be inside');
  assert.equal(scan1.guest.name, 'Elena Rostova');

  // Scan in band 2 for guest 2
  const scan2 = callDoPost({
    action: 'scan',
    auth: { monitorToken },
    shortCode: band2.shortCode,
    direction: 'in',
    guestId: guest2.id,
  });
  assert.equal(scan2.inside, true, 'Band 2 should be inside');

  // Idempotency test: repeated requestId returns cached response
  const reqId = 'test-idemp-123';
  const idemScan1 = callDoPost({
    action: 'scan',
    auth: { monitorToken },
    requestId: reqId,
    shortCode: band1.shortCode,
    direction: 'in',
    guestId: guest1.id,
  });
  const idemScan2 = callDoPost({
    action: 'scan',
    auth: { monitorToken },
    requestId: reqId,
    shortCode: band1.shortCode,
    direction: 'in',
    guestId: guest1.id,
  });
  assert.deepEqual(idemScan1, idemScan2, 'Idempotent request should return cached response');

  // 6. Departures (2 bands leaving together)
  const depRes = callDoPost({
    action: 'departures',
    auth: { monitorToken },
    shortCodes: [band1.shortCode, band2.shortCode],
  });
  assert.ok(depRes.groupId, 'groupId must be generated');
  assert.equal(depRes.people.length, 2, 'Two people should leave together');
  assert.equal(JSON.stringify(depRes).includes('@'), false, 'Departures response must not contain email');

  // 7. Dashboard check
  const dashRes = callDoPost({
    action: 'dashboard',
    auth: { monitorToken },
  });
  assert.ok(dashRes.roster, 'Dashboard must include roster');
  assert.ok(dashRes.recentDepartures, 'Dashboard must include recentDepartures');
  assert.equal(dashRes.recentDepartures.length, 1, 'Should record 1 departure group');
  assert.equal(dashRes.recentDepartures[0].people.length, 2, 'Departure group should have 2 people');

  // Check that departure group mates are linked
  const rosterElena = dashRes.roster.find(r => r.name === 'Elena Rostova');
  assert.ok(rosterElena, 'Elena Rostova should be on roster');
  assert.equal(rosterElena.status, 'left', 'Elena should have left');
  assert.ok(rosterElena.leftWith.includes(guest2.name), 'Elena should have left with guest2');

  // 8. Admin endpoints: event stats, timeline, export.csv, bands.csv
  const eventRes = callDoPost({
    action: 'event',
    auth: { adminPin },
  });
  assert.ok(eventRes.stats, 'Event stats should be returned');
  assert.ok(eventRes.stats.guests >= 2, 'Should have guests');

  const timelineRes = callDoPost({
    action: 'timeline',
    auth: { adminPin },
    guestId: guest1.id,
  });
  assert.equal(timelineRes.guest.name, 'Elena Rostova');
  assert.ok(timelineRes.events.length >= 3, 'Timeline should include id_check, in scan, and departure');
  assert.ok(timelineRes.leftWith.length >= 1, 'Timeline leftWith should include guest2');

  const exportCsvRes = callDoPost({
    action: 'exportCsv',
    auth: { adminPin },
  });
  assert.ok(exportCsvRes.csv.includes('name,email,phone,band,first in,last out,left with'));
  assert.ok(exportCsvRes.csv.includes('Elena Rostova'));

  const bandsCsvRes = callDoPost({
    action: 'bandsCsv',
    auth: { adminPin },
  });
  assert.ok(bandsCsvRes.csv.includes('shortCode,url'));

  // 9. Privacy assertions across all monitor responses & sheet rows
  const dashJson = JSON.stringify(dashRes);
  assert.equal(dashJson.includes('@'), false, 'Dashboard must not contain email');
  assert.equal(dashJson.includes(rawLicense), false, 'Dashboard must not contain license number');

  // Assert raw license number is NEVER stored anywhere in the sheet
  for (const [sheetName, sheet] of sheetsMap.entries()) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        assert.equal(
          String(cell).includes(rawLicense),
          false,
          `Raw license number ${rawLicense} found in sheet ${sheetName}!`
        );
      }
    }
  }

  // Assert Scans and Departures tabs do NOT contain emails or phone numbers
  const scansSheet = sheetsMap.get('Scans');
  const depsSheet = sheetsMap.get('Departures');

  for (const row of scansSheet.rows) {
    for (const cell of row) {
      assert.equal(String(cell).includes('@'), false, 'Scans sheet must not contain email');
    }
  }

  for (const row of depsSheet.rows) {
    for (const cell of row) {
      assert.equal(String(cell).includes('@'), false, 'Departures sheet must not contain email');
    }
  }

  // 10. Retention job test
  context.endEvent ? context.endEvent() : callDoPost({ action: 'endEvent', auth: { adminPin } });
  // Simulate 35 days past endsAt
  const pastDate = new Date(Date.now() - 35 * 86400000).toISOString();
  context.updateSettings({ endsAt: pastDate, retentionDays: 30 });
  context.runRetention();

  assert.equal(sheetsMap.get('Guests').rows.length, 1, 'Retention should clear Guests to header only');
  assert.equal(sheetsMap.get('Bands').rows.length, 1, 'Retention should clear Bands to header only');
  assert.equal(sheetsMap.get('Scans').rows.length, 1, 'Retention should clear Scans to header only');
  assert.equal(sheetsMap.get('Departures').rows.length, 1, 'Retention should clear Departures to header only');

  // 11. Public pilot sign-up: stored, validated, formula-safe
  const ok = callDoPost({ action: 'pilot', chapter: 'Alpha Test', school: 'Test U', email: 'risk@example.test', eventSize: 120, note: '=HYPERLINK("x")' });
  assert.equal(ok.ok, true);
  const pilotRows = sheetsMap.get('Pilot').rows;
  assert.equal(pilotRows.length, 2, 'Pilot sheet should have header + 1 row');
  assert.equal(pilotRows[1][5], `'=HYPERLINK("x")`, 'Formula-like input is escaped');
  const bad = callDoPost({ action: 'pilot', chapter: 'X', school: 'Y', email: 'not-an-email' });
  assert.equal(bad.error, 'invalid_pilot');
});
