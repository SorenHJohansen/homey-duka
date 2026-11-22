'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeSchedule } = require('../lib/duka-schedule');

function entry(weekday, period, speed, hours, minutes = 0) {
  return { weekday, period, speed, reserved: 0, minutes, hours };
}

test('schedule summary lists each day in order', () => {
  const summary = summarizeSchedule([
    entry(1, 1, 1, 6),
    entry(1, 2, 2, 9),
    entry(2, 1, 1, 6),
    entry(7, 1, 0, 23, 30),
  ]);

  assert.equal(
    summary,
    'Mon 06:00 S1, 09:00 S2; Tue 06:00 S1; Sun 23:30 off',
  );
});

test('a period ending at midnight is shown as 24:00', () => {
  assert.equal(summarizeSchedule([entry(3, 4, 1, 0, 0)]), 'Wed 24:00 S1');
});

test('an empty schedule summarizes to an empty string', () => {
  assert.equal(summarizeSchedule([]), '');
});

test('entries outside the week are ignored', () => {
  const summary = summarizeSchedule([entry(0, 1, 1, 6), entry(8, 1, 1, 6), entry(1, 1, 1, 6)]);
  assert.equal(summary, 'Mon 06:00 S1');
});
