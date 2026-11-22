'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DukaClient } = require('../lib/duka-client');
const { createPairHandlers } = require('../lib/duka-pair');
const { familyForUnitType, matchesFamily } = require('../lib/duka-family');
const {
  FakeSocket,
  firmwareResponse,
  searchResponse,
  s6wStatusResponse,
  smartStatusResponse,
} = require('./helpers');

const DEVICE = '1234567890123456';
const OTHER = '9999999999999999';

function fastDelay() {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

function makeClient() {
  const socket = new FakeSocket();
  const client = new DukaClient({
    createSocket: () => socket,
    delay: fastDelay,
    broadcastAddresses: () => ['192.0.2.255'],
  });
  return { client, socket };
}

test('unit types map to families', () => {
  assert.equal(familyForUnitType(6), 'smart');
  assert.equal(familyForUnitType(14), 's6w');
  assert.equal(familyForUnitType(null), null);
  assert.equal(familyForUnitType(undefined), null);
  assert.equal(familyForUnitType(99), 'unsupported');

  assert.equal(matchesFamily(null, 's6w'), true);
  assert.equal(matchesFamily(null, 'smart'), true);
  assert.equal(matchesFamily('s6w', 's6w'), true);
  assert.equal(matchesFamily('smart', 's6w'), false);
  assert.equal(matchesFamily('unsupported', 's6w'), false);
});

test('search lists units with and without a reported unit type', async () => {
  const { client, socket } = makeClient();
  let answered = false;

  socket.onSend = (packet) => {
    if (answered || !packet.includes(0x7c)) return;
    answered = true;
    socket.message(searchResponse(DEVICE, DEVICE, 14));
    socket.message(searchResponse(OTHER, OTHER, null));
  };

  const found = await client.search(10);
  await client.stop();

  const byId = new Map(found.map((device) => [device.id, device]));
  assert.equal(byId.get(DEVICE).family, 's6w');
  assert.equal(byId.get(OTHER).family, null);
});

test('probe waits for the status reply and keeps the manual speed', async () => {
  const { client, socket } = makeClient();

  socket.onSend = (packet) => {
    if (packet.includes(0x86)) socket.message(firmwareResponse(DEVICE, 14));
    else if (packet.includes(0xb7)) socket.message(s6wStatusResponse(DEVICE));
  };

  const info = await client.probe({
    id: DEVICE.toLowerCase(),
    password: '1111',
    address: '192.0.2.10',
    timeoutMs: 2000,
  });
  await client.stop();

  assert.equal(info.id, DEVICE);
  assert.equal(info.family, 's6w');
  assert.equal(info.unitType, 14);
  assert.equal(info.isOn, true);
  assert.equal(info.manualSpeed, 128);
  assert.ok(socket.sent.some((entry) => entry.packet.includes(0xb7)));
  assert.ok(!socket.sent.some((entry) => entry.packet.includes(0x18)));
});

test('probe discovers the address without broadcasting credentials', async () => {
  const { client, socket } = makeClient();

  socket.onSend = (packet) => {
    if (packet.includes(0x7c)) socket.message(searchResponse(DEVICE, DEVICE, 14), '192.0.2.10');
    else if (packet.includes(0x86)) socket.message(firmwareResponse(DEVICE, 14), '192.0.2.10');
    else if (packet.includes(0xb7)) socket.message(s6wStatusResponse(DEVICE), '192.0.2.10');
  };

  const info = await client.probe({ id: DEVICE, password: '1111', timeoutMs: 2000 });
  await client.stop();

  assert.equal(info.address, '192.0.2.10');
  assert.ok(
    socket.sent.some((entry) => entry.address === '192.0.2.10' && entry.packet.includes(0xb7)),
  );

  const broadcast = new Set(['255.255.255.255', '192.0.2.255']);
  for (const entry of socket.sent) {
    if (!broadcast.has(entry.address)) continue;
    assert.ok(!entry.packet.includes(0x86), 'firmware request was broadcast');
    assert.ok(!entry.packet.includes(0xb7), 'status request was broadcast');
  }
});

test('probe falls back to the selected family when no unit type is reported', async () => {
  const { client, socket } = makeClient();

  socket.onSend = (packet) => {
    if (packet.includes(0x86)) socket.message(firmwareResponse(DEVICE));
    else if (packet.includes(0xb7)) socket.message(s6wStatusResponse(DEVICE));
  };

  const info = await client.probe({
    id: DEVICE,
    password: '1111',
    address: '192.0.2.10',
    family: 's6w',
    timeoutMs: 2000,
  });
  await client.stop();

  assert.equal(info.family, 's6w');
  assert.equal(info.unitType, null);
  assert.equal(info.isOn, true);
  assert.equal(info.manualSpeed, 128);
});

test('probe does not return before the status reply', async () => {
  const { client, socket } = makeClient();
  let statusRequests = 0;

  socket.onSend = (packet) => {
    if (packet.includes(0x86)) {
      socket.message(firmwareResponse(DEVICE, 14));
    } else if (packet.includes(0xb7)) {
      statusRequests += 1;
      if (statusRequests >= 2) socket.message(s6wStatusResponse(DEVICE));
    }
  };

  const info = await client.probe({
    id: DEVICE,
    password: '1111',
    address: '192.0.2.10',
    timeoutMs: 2000,
  });
  await client.stop();

  assert.ok(statusRequests >= 2);
  assert.equal(info.isOn, true);
  assert.equal(info.manualSpeed, 128);
});

test('probe selects the smart status set for unit type 6', async () => {
  const { client, socket } = makeClient();

  socket.onSend = (packet) => {
    if (packet.includes(0x86)) socket.message(firmwareResponse(DEVICE, 6));
    else if (packet.includes(0x18)) socket.message(smartStatusResponse(DEVICE));
  };

  const info = await client.probe({
    id: DEVICE,
    password: '1111',
    address: '192.0.2.10',
    timeoutMs: 2000,
  });
  await client.stop();

  assert.equal(info.family, 'smart');
  assert.equal(info.isOn, true);
  assert.equal(info.humidity, 61);
  assert.equal(info.maxSpeed, 74);
  assert.equal(info.silentSpeed, 85);
  assert.equal(info.boostTimer, 900);
  assert.equal(info.turnOnDelay, 0);

  const status = socket.sent.find((entry) => entry.packet.includes(0x18));
  assert.ok(status);
  assert.ok(!status.packet.includes(0xb7));
});

test('probe reports unsupported unit types', async () => {
  const { client, socket } = makeClient();

  socket.onSend = (packet) => {
    if (packet.includes(0x86)) socket.message(firmwareResponse(DEVICE, 99));
  };

  const info = await client.probe({
    id: DEVICE,
    password: '1111',
    address: '192.0.2.10',
    timeoutMs: 2000,
  });
  await client.stop();

  assert.equal(info.family, 'unsupported');
  assert.equal(info.isOn, null);
});

function makePairHandlers(searchResults, probeResult) {
  const handlers = {};
  const driver = {
    homey: {
      app: {
        duka: {
          search: async () => searchResults,
          probe: async (args) => ({ ...probeResult, id: args.id, address: args.address }),
        },
      },
      __: (key) => key,
    },
  };
  const session = {
    setHandler: (name, handler) => {
      handlers[name] = handler;
    },
  };
  createPairHandlers(driver, session, 's6w');
  return handlers;
}

test('refresh requests are coalesced per device', async () => {
  const socket = new FakeSocket();
  const timers = new Map();
  let nextTimerId = 0;
  const client = new DukaClient({
    createSocket: () => socket,
    delay: fastDelay,
    broadcastAddresses: () => ['192.0.2.255'],
    setTimeout: (fn) => {
      const timer = { id: (nextTimerId += 1), fn };
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer.id),
  });

  await client.start();
  const device = client._ensureDevice({
    id: DEVICE,
    password: '1111',
    address: '192.0.2.10',
    family: 's6w',
  });

  client._scheduleRefresh(device, 100);
  client._scheduleRefresh(device, 100);
  assert.equal(timers.size, 1);

  const [timer] = timers.values();
  timers.clear();
  timer.fn();
  await fastDelay();

  assert.ok(socket.sent.some((entry) => entry.packet.includes(0xb7)));
  await client.stop();
});

test('commands reject when the socket send fails', async () => {
  const { client, socket } = makeClient();
  await client.start();
  const device = client._ensureDevice({
    id: DEVICE,
    password: '1111',
    address: '192.0.2.10',
    family: 's6w',
  });

  socket.failSend = true;
  await assert.rejects(client.turnOn(device), /send failed/);
  await client.stop();
});

test('pair search keeps unknown families and drops known mismatches', async () => {
  const handlers = makePairHandlers(
    [
      { id: 'A', address: '1', family: 's6w' },
      { id: 'B', address: '2', family: 'smart' },
      { id: 'C', address: '3', family: null },
      { id: 'D', address: '4', family: 'unsupported' },
    ],
    {},
  );

  const found = await handlers.search();
  assert.deepEqual(
    found.map((device) => device.id),
    ['A', 'C'],
  );
});

test('pair add falls back to the selected driver for an unknown family', async () => {
  const handlers = makePairHandlers([], {
    family: null,
    manualSpeed: 128,
    address: '192.0.2.10',
    firmwareVersion: '1.0',
    unitType: null,
  });

  const result = await handlers.add({ deviceId: 'abcdef0123456789' });
  assert.equal(result.family, 's6w');
  assert.equal(result.manualSpeed, true);
  assert.equal(result.id, 'ABCDEF0123456789');
});

test('pair add rejects a known mismatch', async () => {
  const handlers = makePairHandlers([], {
    family: 'smart',
    manualSpeed: null,
    address: '192.0.2.10',
  });

  await assert.rejects(handlers.add({ deviceId: DEVICE }), /wrong_model/);
});

test('pair add rejects unsupported models', async () => {
  const handlers = makePairHandlers([], {
    family: 'unsupported',
    manualSpeed: null,
    address: '192.0.2.10',
  });

  await assert.rejects(handlers.add({ deviceId: DEVICE }), /unsupported_model/);
});
