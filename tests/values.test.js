'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  roundToStep,
  changedByAtLeast,
  TEMPERATURE_STEP,
  RPM_STEP,
  HUMIDITY_STEP,
} = require('../lib/duka-values');
const { pollIntervalForAge, firmwareRetryInterval } = require('../lib/duka-backoff');

test('temperature is rounded to 0.1 C', () => {
  assert.ok(Math.abs(roundToStep(21.34, TEMPERATURE_STEP) - 21.3) < 1e-9);
  assert.ok(Math.abs(roundToStep(21.36, TEMPERATURE_STEP) - 21.4) < 1e-9);
  assert.ok(Math.abs(roundToStep(21.345, TEMPERATURE_STEP) - 21.3) < 1e-9);
});

test('rpm uses a 100 rpm deadband and treats zero as a state change', () => {
  assert.equal(changedByAtLeast(1000, 1050, RPM_STEP), false);
  assert.equal(changedByAtLeast(1000, 1099, RPM_STEP), false);
  assert.equal(changedByAtLeast(1000, 1100, RPM_STEP), true);
  assert.equal(changedByAtLeast(null, 20, RPM_STEP), true);

  assert.equal(changedByAtLeast(0, 60, RPM_STEP, true), false);
  assert.equal(changedByAtLeast(120, 0, RPM_STEP, true), true);
  assert.equal(changedByAtLeast(0, 0, RPM_STEP, true), false);
});

test('humidity uses a 5 point deadband', () => {
  assert.equal(HUMIDITY_STEP, 5);
  assert.equal(changedByAtLeast(60, 62, HUMIDITY_STEP), false);
  assert.equal(changedByAtLeast(60, 64, HUMIDITY_STEP), false);
  assert.equal(changedByAtLeast(60, 65, HUMIDITY_STEP), true);
  assert.equal(changedByAtLeast(60, 55, HUMIDITY_STEP), true);
  assert.equal(changedByAtLeast(null, 45, HUMIDITY_STEP), true);
});

test('polling backs off for offline units', () => {
  assert.equal(pollIntervalForAge(0), 15 * 1000);
  assert.equal(pollIntervalForAge(90 * 1000), 30 * 1000);
  assert.equal(pollIntervalForAge(16 * 60 * 1000), 2 * 60 * 1000);
});

test('firmware retries slow down after three attempts', () => {
  assert.equal(firmwareRetryInterval(0), 30 * 1000);
  assert.equal(firmwareRetryInterval(2), 30 * 1000);
  assert.equal(firmwareRetryInterval(3), 5 * 60 * 1000);
  assert.equal(firmwareRetryInterval(10), 5 * 60 * 1000);
});
