'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('runtime modules exist and load', () => {
  for (const module of [
    '../lib/duka-protocol',
    '../lib/duka-client',
    '../lib/duka-pair',
    '../lib/duka-family',
  ]) {
    assert.doesNotThrow(() => require(module), `cannot load ${module}`);
  }
  for (const file of [
    'app.js',
    'lib/duka-device.js',
    'drivers/duka/driver.js',
    'drivers/duka/device.js',
    'drivers/duka_smart/driver.js',
    'drivers/duka_smart/device.js',
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  }
});

test('app manifest uses the DUKA identity and required metadata', () => {
  const app = read('.homeycompose/app.json');
  assert.equal(app.id, 'dk.hjohansen.duka');
  assert.equal(app.name.en, 'DUKA');
  assert.match(app.version, /^\d+\.\d+\.\d+$/);
  assert.ok(app.platforms.includes('local'));
  assert.ok(app.description.en);
  assert.ok(app.author.email);
  assert.ok(app.support);
  assert.ok(app.source);
  assert.ok(app.bugs.url);
  assert.ok(app.contributors.developers.some((entry) => entry.name === 'dingusdk'));
});

test('drivers expose the expected capability sets', () => {
  const s6w = read('drivers/duka/driver.compose.json');
  const smart = read('drivers/duka_smart/driver.compose.json');

  for (const capability of [
    'onoff',
    'dim',
    'measure_humidity',
    'duka_mode',
    'alarm_filter',
    'duka_filter_days',
    'button.reset_filter',
  ]) {
    assert.ok(s6w.capabilities.includes(capability), `S6W is missing ${capability}`);
  }

  for (const capability of [
    'onoff',
    'measure_humidity',
    'measure_temperature',
    'duka_boost',
    'duka_24h',
    'duka_interval',
    'duka_silent_speed',
    'duka_max_speed',
    'duka_fan_rpm',
  ]) {
    assert.ok(smart.capabilities.includes(capability), `smart fan is missing ${capability}`);
  }

  assert.ok(!s6w.capabilities.includes('duka_boost'));
  assert.ok(!smart.capabilities.includes('dim'));
  assert.equal(s6w.class, 'fan');
  assert.equal(smart.class, 'fan');
});
