'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { S6W_CAPABILITIES, SMART_CAPABILITIES } = require('../lib/duka-capabilities');

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
    '../lib/duka-values',
    '../lib/duka-backoff',
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
    'duka_fan_speed',
    'duka_humidity_setpoint',
    'measure_humidity',
    'duka_mode',
    'duka_timer_mode',
    'duka_timer_minutes',
    'duka_schedule',
    'duka_schedule_text',
    'duka_analog_level',
    'duka_humidity_boost',
    'duka_analog_boost',
    'duka_relay_active',
    'alarm_generic',
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
    'measure_fan_rpm',
    'duka_boost_minutes',
    'duka_silent_active',
    'duka_interval_active',
  ]) {
    assert.ok(smart.capabilities.includes(capability), `smart fan is missing ${capability}`);
  }

  assert.ok(!smart.capabilities.includes('duka_motion_active'));

  assert.ok(!s6w.capabilities.includes('duka_boost'));
  assert.ok(!s6w.capabilities.includes('dim'));
  assert.ok(!smart.capabilities.includes('dim'));
  assert.equal(s6w.class, 'fan');
  assert.equal(smart.class, 'fan');
});

test('fan RPM is recorded in Insights and can be the status indicator', () => {
  const rpm = read('.homeycompose/capabilities/measure_fan_rpm.json');
  assert.equal(rpm.type, 'number');
  assert.equal(rpm.insights, true);
  assert.equal(rpm.uiComponent, 'sensor');
  assert.equal(rpm.units.en, 'rpm');

  const smart = read('drivers/duka_smart/driver.compose.json');
  const id = smart.capabilities.find((capability) => capability.includes('rpm'));
  assert.match(id, /^measure_/);
});

test('the startup capability lists match the driver manifests', () => {
  const s6w = read('drivers/duka/driver.compose.json');
  const smart = read('drivers/duka_smart/driver.compose.json');

  assert.deepEqual([...S6W_CAPABILITIES].sort(), [...s6w.capabilities].sort());
  assert.deepEqual([...SMART_CAPABILITIES].sort(), [...smart.capabilities].sort());
});

test('the S6W fan speed is a titled slider', () => {
  const speed = read('.homeycompose/capabilities/duka_fan_speed.json');
  assert.equal(speed.type, 'number');
  assert.equal(speed.uiComponent, 'slider');
  assert.equal(speed.title.en, 'Fan speed');
  assert.equal(speed.units.en, '%');
  assert.equal(speed.min, 0);
  assert.equal(speed.max, 100);
  assert.equal(speed.setable, true);
});

test('the S6W exposes the unit settings', () => {  const settings = read('drivers/duka/driver.settings.compose.json');
  const byId = new Map();
  const collect = (items) => {
    for (const item of items) {
      if (item.children) collect(item.children);
      else byId.set(item.id, item);
    }
  };
  collect(settings);

  for (const id of [
    'humidity_sensor',
    'analog_sensor',
    'analog_threshold',
    'relay_sensor',
    'boost_delay',
    'night_minutes',
    'night_hours',
    'party_minutes',
    'party_hours',
    'filter_interval',
    'supply_speed_1',
    'exhaust_speed_1',
    'supply_speed_2',
    'exhaust_speed_2',
    'supply_speed_3',
    'exhaust_speed_3',
    'humidity_step',
  ]) {
    assert.ok(byId.has(id), `missing setting ${id}`);
  }

  assert.equal(byId.get('filter_interval').max, 365);
});

test('the S6W exposes timer and schedule Flow actions', () => {  const flow = read('drivers/duka/driver.flow.compose.json');
  const ids = flow.actions.map((action) => action.id);

  for (const id of ['set_timer_mode', 'set_schedule', 'set_schedule_period', 'read_schedule']) {
    assert.ok(ids.includes(id), `missing Flow action ${id}`);
  }

  const period = flow.actions.find((action) => action.id === 'set_schedule_period');
  assert.deepEqual(
    period.args.map((arg) => arg.name),
    ['weekday', 'period', 'speed', 'hours', 'minutes'],
  );
});

test('the smart fan exposes its unit settings', () => {
  const settings = read('drivers/duka_smart/driver.settings.compose.json');
  const byId = new Map();
  const collect = (items) => {
    for (const item of items) {
      if (item.children) collect(item.children);
      else byId.set(item.id, item);
    }
  };
  collect(settings);

  for (const id of [
    'humidity_mode',
    'humidity_setpoint',
    'temperature_mode',
    'temperature_setpoint',
    'switch_mode',
    'interval_percentage',
    'silent_enabled',
    'silent_start',
    'silent_end',
    'turn_off_delay',
    'turn_on_delay',
    'humidity_step',
    'temperature_step',
    'rpm_step',
  ]) {
    assert.ok(byId.has(id), `missing setting ${id}`);
  }

  assert.equal(byId.get('humidity_setpoint').max, 100);
  assert.equal(byId.get('silent_start').pattern, '^([01]?[0-9]|2[0-3]):[0-5][0-9]$');
});

test('the schedule text stays available without taking tile space', () => {
  const schedule = read('.homeycompose/capabilities/duka_schedule_text.json');
  assert.equal(schedule.type, 'string');
  assert.equal(schedule.uiComponent, null);
  assert.equal(schedule.getable, true);
});

test('the schedule widget is limited to the S6W', () => {
  const widget = read('widgets/duka_schedule/widget.compose.json');
  assert.equal(widget.devices.type, 'app');
  assert.equal(widget.devices.singular, true);
  assert.equal(widget.devices.filter.capabilities, 'duka_schedule_text');
  assert.equal(widget.api.getSchedule.method, 'GET');
  assert.equal(widget.api.setEntry.method, 'PUT');
  assert.equal(widget.api.setSchedule.method, 'PUT');
});
