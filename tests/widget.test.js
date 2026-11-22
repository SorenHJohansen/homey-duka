'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const api = require('../widgets/duka_schedule/api');

function fakeHomey(device) {
  return {
    drivers: {
      getDriver: (id) => {
        assert.equal(id, 'duka');
        return { getDevice: ({ id: deviceId }) => (deviceId === 'abc' ? device : null) };
      },
    },
  };
}

test('the widget returns the schedule and its state', async () => {
  const device = {
    entries: [{ weekday: 1, period: 1, speed: 1, minutes: 0, hours: 6, reserved: 0 }],
    async readScheduleQueued() {
      return this.entries;
    },
    getCapabilityValue: () => true,
  };

  const result = await api.getSchedule({ homey: fakeHomey(device), query: { deviceId: 'abc' } });
  assert.equal(result.schedule, true);
  assert.equal(result.entries.length, 1);
});

test('the widget writes one entry and returns the fresh schedule', async () => {
  const written = [];
  const device = {
    entries: [],
    async setSchedulePeriod(entry) {
      written.push(entry);
      this.entries = [{ weekday: entry.weekday, period: entry.period, speed: entry.speed, minutes: 0, hours: 6, reserved: 0 }];
      return this.entries;
    },
  };

  const result = await api.setEntry({
    homey: fakeHomey(device),
    body: { deviceId: 'abc', entry: { weekday: 2, period: 3, speed: 2, hours: 6, minutes: 30 } },
  });

  assert.deepEqual(written, [
    { weekday: 2, period: 3, speed: 2, reserved: undefined, minutes: 30, hours: 6 },
  ]);
  assert.equal(result.entries[0].period, 3);
});

test('the widget keeps the reserved byte it was given', async () => {
  const written = [];
  const device = {
    async setSchedulePeriod(entry) {
      written.push(entry);
      return [entry];
    },
  };

  await api.setEntry({
    homey: fakeHomey(device),
    body: {
      deviceId: 'abc',
      entry: { weekday: 1, period: 1, speed: 1, hours: 6, minutes: 0, reserved: 15 },
    },
  });

  assert.equal(written[0].reserved, 15);
});

test('the widget rejects an entry that is out of range', async () => {
  const device = {
    async setSchedulePeriod() {
      throw new Error('should not be called');
    },
  };

  for (const entry of [
    { weekday: 1, period: 9, speed: 1, hours: 6, minutes: 0 },
    { weekday: -1, period: 1, speed: 1, hours: 6, minutes: 0 },
    { weekday: 1, period: 1, speed: 9, hours: 6, minutes: 0 },
    { weekday: 1, period: 1, speed: 1, hours: 99, minutes: 0 },
    { weekday: 1, period: 1, speed: 1, hours: 24, minutes: 30 },
  ]) {
    await assert.rejects(
      api.setEntry({ homey: fakeHomey(device), body: { deviceId: 'abc', entry } }),
      /Invalid schedule|24:00/,
    );
  }
});

test('the widget switches the schedule on and off', async () => {
  let value = null;
  const device = {
    async setSchedule(on) {
      value = on;
    },
  };

  const result = await api.setSchedule({
    homey: fakeHomey(device),
    body: { deviceId: 'abc', enabled: true },
  });

  assert.equal(value, true);
  assert.equal(result.schedule, true);
});

test('the widget rejects an unknown device', async () => {
  await assert.rejects(
    api.getSchedule({ homey: fakeHomey({}), query: { deviceId: 'nope' } }),
    /not a DUKA S6W/,
  );
});
