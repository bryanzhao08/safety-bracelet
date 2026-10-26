import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupByNight,
  recap,
  shareText,
  formatTime,
  formatNightLabel
} from '../web/app/lib/nights.js';

test('nights: formatTime and formatNightLabel with explicit tzOffsetMin', () => {
  // 2026-10-23T22:42:00Z in UTC (tzOffsetMin = 0)
  assert.equal(formatTime('2026-10-23T22:42:00Z', 0), '10:42 pm');
  assert.equal(formatTime('2026-10-24T02:15:00Z', 0), '2:15 am');
  assert.equal(formatTime('2026-10-24T00:05:00Z', 0), '12:05 am');
  assert.equal(formatTime('2026-10-24T12:00:00Z', 0), '12:00 pm');

  // Night label for Friday night running across midnight into Saturday morning
  // 10:42 pm Friday
  assert.equal(formatNightLabel('2026-10-23T22:42:00Z', 0), 'Fri, Oct 23');
  // 2:15 am Saturday morning (still part of Friday night!)
  assert.equal(formatNightLabel('2026-10-24T02:15:00Z', 0), 'Fri, Oct 23');
  // 11:59 am Saturday morning (still part of Friday night!)
  assert.equal(formatNightLabel('2026-10-24T11:59:00Z', 0), 'Fri, Oct 23');
  // 12:05 pm Saturday afternoon (new night: Saturday night!)
  assert.equal(formatNightLabel('2026-10-24T12:05:00Z', 0), 'Sat, Oct 24');
});

test('nights: noon-to-noon grouping across midnight', () => {
  const entries = [
    { id: '1', type: 'met', at: '2026-10-23T22:42:00Z', personId: 'p1', name: 'Jordan' },
    { id: '2', type: 'note', at: '2026-10-24T01:00:00Z', text: 'at Sigma Chi' },
    { id: '3', type: 'home', at: '2026-10-24T02:15:00Z' },
    // Next night (Saturday after noon)
    { id: '4', type: 'met', at: '2026-10-24T23:00:00Z', personId: 'p2', name: 'Sam' }
  ];

  const nights = groupByNight(entries, { tzOffsetMin: 0 });
  assert.equal(nights.length, 2);

  const satNight = nights[0];
  const friNight = nights[1];

  assert.equal(friNight.key, '2026-10-23');
  assert.equal(friNight.label, 'Fri, Oct 23');
  assert.equal(friNight.entries.length, 3);
  assert.equal(friNight.entries[0].id, '1');
  assert.equal(friNight.entries[1].id, '2');
  assert.equal(friNight.entries[2].id, '3');

  assert.equal(satNight.key, '2026-10-24');
  assert.equal(satNight.label, 'Sat, Oct 24');
  assert.equal(satNight.entries.length, 1);
  assert.equal(satNight.entries[0].id, '4');
});

test('nights: newest night first', () => {
  const entries = [
    { id: 'e1', type: 'met', at: '2026-10-22T21:00:00Z', personId: 'p1', name: 'A' },
    { id: 'e2', type: 'met', at: '2026-10-24T21:00:00Z', personId: 'p2', name: 'B' },
    { id: 'e3', type: 'met', at: '2026-10-23T21:00:00Z', personId: 'p3', name: 'C' }
  ];

  const nights = groupByNight(entries, { tzOffsetMin: 0 });
  assert.equal(nights.length, 3);
  assert.equal(nights[0].key, '2026-10-24');
  assert.equal(nights[1].key, '2026-10-23');
  assert.equal(nights[2].key, '2026-10-22');
});

test('nights: 10-minute collapse keeps first for same person', () => {
  const entries = [
    // p1 met at 22:00
    { id: '1', type: 'met', at: '2026-10-23T22:00:00Z', personId: 'p1', name: 'Jordan' },
    // p1 scanned again at 22:05 (within 10m -> collapsed)
    { id: '2', type: 'met', at: '2026-10-23T22:05:00Z', personId: 'p1', name: 'Jordan', again: true },
    // p2 met at 22:07 (different person -> kept)
    { id: '3', type: 'met', at: '2026-10-23T22:07:00Z', personId: 'p2', name: 'Maya' },
    // p1 scanned at 22:15 (15m after 22:00 -> kept)
    { id: '4', type: 'met', at: '2026-10-23T22:15:00Z', personId: 'p1', name: 'Jordan', again: true },
    // Note at 22:16 (notes never collapsed)
    { id: '5', type: 'note', at: '2026-10-23T22:16:00Z', text: 'leaving' }
  ];

  const nights = groupByNight(entries, { tzOffsetMin: 0 });
  assert.equal(nights.length, 1);
  const remainingIds = nights[0].entries.map(e => e.id);
  assert.deepEqual(remainingIds, ['1', '3', '4', '5']);
});

test('nights: recap lastWith and wentHome', () => {
  const night = {
    key: '2026-10-23',
    label: 'Fri, Oct 23',
    entries: [
      { id: '1', type: 'met', at: '2026-10-23T22:00:00Z', personId: 'p1', name: 'Jordan' },
      { id: '2', type: 'met', at: '2026-10-23T23:30:00Z', personId: 'p2', name: 'Maya' },
      { id: '3', type: 'met', at: '2026-10-24T01:15:00Z', personId: 'p3', name: 'Priya' },
      { id: '4', type: 'note', at: '2026-10-24T01:45:00Z', text: 'took Uber' },
      { id: '5', type: 'home', at: '2026-10-24T02:15:00Z' }
    ]
  };

  const rec = recap(night);
  assert.equal(rec.people, 3);
  assert.equal(rec.first, '2026-10-23T22:00:00Z');
  assert.equal(rec.last, '2026-10-24T02:15:00Z');
  assert.deepEqual(rec.lastWith, {
    personId: 'p3',
    name: 'Priya',
    at: '2026-10-24T01:15:00Z'
  });
  assert.equal(rec.wentHome, '2026-10-24T02:15:00Z');

  // Recap with no met and no home
  const emptyRecap = recap({ entries: [] });
  assert.equal(emptyRecap.people, 0);
  assert.equal(emptyRecap.first, null);
  assert.equal(emptyRecap.last, null);
  assert.equal(emptyRecap.lastWith, null);
  assert.equal(emptyRecap.wentHome, null);
});

test('nights: shareText format matches spec', () => {
  const night = {
    key: '2026-10-23',
    label: 'Fri, Oct 23',
    tzOffsetMin: 0,
    entries: [
      { id: '1', type: 'met', at: '2026-10-23T22:42:00Z', name: 'Jordan' },
      { id: '2', type: 'note', at: '2026-10-24T00:30:00Z', text: 'at Sigma Chi' },
      { id: '3', type: 'home', at: '2026-10-24T02:15:00Z' }
    ]
  };

  const text = shareText(night, { tzOffsetMin: 0 });
  const expected = 'Fri, Oct 23\n10:42 pm met Jordan\n12:30 am at Sigma Chi\n2:15 am home';
  assert.equal(text, expected);
});
