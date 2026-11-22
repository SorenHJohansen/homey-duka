'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  roundToStep,
  changedByAtLeast,
  stepsFromSettings,
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

test('deadbands come from settings with safe fallbacks', () => {
  assert.deepEqual(stepsFromSettings({}), {
    humidity: HUMIDITY_STEP,
    temperature: TEMPERATURE_STEP,
    rpm: RPM_STEP,
  });

  assert.deepEqual(
    stepsFromSettings({ humidity_step: 8, temperature_step: 0.5, rpm_step: 200 }),
    { humidity: 8, temperature: 0.5, rpm: 200 },
  );

  assert.equal(stepsFromSettings({ humidity_step: 'abc' }).humidity, HUMIDITY_STEP);
  assert.equal(stepsFromSettings({ humidity_step: 100 }).humidity, 25);
  assert.equal(stepsFromSettings({ humidity_step: 0 }).humidity, 1);
  assert.equal(stepsFromSettings({ rpm_step: 1 }).rpm, 10);
  assert.equal(stepsFromSettings({ temperature_step: 0 }).temperature, 0.1);
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
