import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set up fake DOM / localStorage environment for Node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) || null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

globalThis.window = {
  location: { search: '?demo=1', pathname: '/site/', href: 'http://localhost:4400/site/?demo=1' },
  history: {
    replaceState: (_state, _title, url) => {
      const u = new URL(url, 'http://localhost:4400');
      globalThis.window.location.search = u.search;
      globalThis.window.location.pathname = u.pathname;
    },
  },
};

test('Demo backend: detection, seeding, door, dashboard, admin, and meetups', async () => {
  store.clear();
  globalThis.window.location.search = '?demo=1';

  const { isDemo, getBackend, startDemo, exitDemo } = await import('../../web/shared/config.js');
  const api = await import('../../web/shared/api.js');

  // 1. Detection priority: ?demo=1 activates demo mode and takes priority
  assert.equal(isDemo(), true, 'isDemo() should return true when ?demo=1 is in URL');
  assert.equal(globalThis.window.location.search, '', 'Query parameter ?demo=1 should be stripped from address bar');
  assert.equal(getBackend().type, 'demo', 'Backend type must be demo');

  // 2. startDemo() seeds realistic party
  const demoInit = await startDemo();
  assert.equal(demoInit.ok, true);
  assert.equal(demoInit.adminPin, '00000000', 'Admin PIN must be 00000000');
  assert.equal(demoInit.monitorCode, 'DEMO42', 'Monitor code must be DEMO42');
  assert.ok(demoInit.sampleBandToken, 'Sample band token should be returned');

  // Verify stored sessions
  const adminSession = api.getAdminSession();
  assert.ok(adminSession, 'Admin session should be set');
  assert.equal(adminSession.pin, '00000000');
  assert.equal(adminSession.monitorCode, 'DEMO42');

  const monitorSession = api.getMonitorSession();
  assert.ok(monitorSession, 'Monitor session should be set');
  assert.equal(monitorSession.name, 'You');
  assert.equal(monitorSession.eventName, 'Sample party: Friday 10 pm');

  // 3. Verify seeded data via dashboard
  const dash = await api.getDashboard();
  assert.equal(dash.event.name, 'Sample party: Friday 10 pm');
  assert.equal(dash.inside, 12, 'About 12 checked in (inside)');
  assert.equal(dash.checkedIn, 16, '16 checked in total over the last 2 hours');
  assert.equal(dash.left, 4, '4 left (2 groups of 2)');
  assert.equal(dash.roster.length, 24, '24 guests on roster');
  assert.equal(dash.recentDepartures.length, 2, '2 groups that left together');
  assert.equal(dash.recentDepartures[0].people.length, 2, 'Group 1 has 2 people');
  assert.equal(dash.recentDepartures[1].people.length, 2, 'Group 2 has 2 people');

  // Verify meetups seeded
  const guestsWithMeetups = dash.roster.filter(r => r.meetups > 0);
  assert.ok(guestsWithMeetups.length >= 4, 'At least 4 guests should have meetups');

  // 4. Verify searchGuests (monitor privacy: no email or phone)
  const searchMaya = await api.searchGuests('Maya');
  assert.equal(searchMaya.length, 1);
  assert.equal(searchMaya[0].name, 'Maya Chen');
  assert.equal(searchMaya[0].email, undefined, 'Search guests must not expose email');
  assert.equal(searchMaya[0].phone, undefined, 'Search guests must not expose phone');

  // 5. Verify timeline includes met events
  const mayaTimeline = await api.getGuestTimeline(demoInit.eventId, searchMaya[0].id);
  const metEvents = mayaTimeline.events.filter(e => e.type === 'met');
  assert.ok(metEvents.length >= 2, 'Maya should have at least 2 met events in timeline');
  assert.ok(metEvents.some(e => e.detail.with === 'Jordan Taylor'), 'Maya met Jordan Taylor');
  assert.ok(metEvents.some(e => e.detail.with === 'Sam Park'), 'Maya met Sam Park');

  // 6. Verify recordMeetup flow
  // Find band tokens from demo sheet
  const rawSheet = JSON.parse(store.get('hb_demo_sheet'));
  const bands = rawSheet.Bands.slice(1);
  const mayaBandToken = bands[0][2];
  const elenaBandToken = bands[3][2];
  const unlinkedBandToken = bands[25][2];

  // Happy path
  const meetRes = await api.recordMeetup(mayaBandToken, elenaBandToken);
  assert.equal(meetRes.ok, true);
  assert.equal(meetRes.with.firstName, 'Elena', 'Only first name returned in meet response');
  assert.equal(meetRes.with.name, undefined);
  assert.equal(meetRes.with.email, undefined);
  assert.equal(meetRes.with.phone, undefined);

  // Dedupe: same pair within 5 min returns existing meetup
  const meetDedupe = await api.recordMeetup(elenaBandToken, mayaBandToken);
  assert.equal(meetDedupe.ok, true);
  assert.equal(meetDedupe.at, meetRes.at, 'Dedupe returns existing timestamp');

  // Not inside: unlinked band cannot tap
  await assert.rejects(
    async () => {
      await api.recordMeetup(unlinkedBandToken, mayaBandToken);
    },
    (err) => err.error === 'not_inside'
  );

  // 7. createEvent in demo mode resets and reseeds
  const reseoded = await api.createEvent({
    name: 'New Sample Party',
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
  });
  assert.equal(reseoded.ok, true);
  assert.equal(reseoded.adminPin, '00000000');
  const newDash = await api.getDashboard();
  assert.equal(newDash.event.name, 'New Sample Party');

  // 8. exitDemo() clears demo flag and sessions
  exitDemo();
  assert.equal(isDemo(), false, 'isDemo() should be false after exitDemo()');
  assert.equal(api.getAdminSession(), null, 'Admin session cleared');
  assert.equal(api.getMonitorSession(), null, 'Monitor session cleared');
});
