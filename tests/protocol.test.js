'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../lib/duka-protocol');

const DEVICE = { id: '1234567890123456', password: '1111' };

function buildResponse(deviceId, password, parameters) {
  const id = Buffer.from(deviceId, 'ascii');
  const pass = Buffer.from(password, 'ascii');
  const body = Buffer.concat([
    Buffer.from([0xfd, 0xfd, 0x02, id.length]),
    id,
    Buffer.from([pass.length]),
    pass,
    Buffer.from([protocol.FUNC.RESPONSE]),
    Buffer.from(parameters),
  ]);
  const tail = Buffer.alloc(2);
  tail.writeUInt16LE(protocol.checksum(body), 0);
  return Buffer.concat([body, tail]);
}

// The expected packets below were produced with the reference Python
// implementation (dukasdk) so the encoder can be checked byte for byte.

test('search packet matches the reference implementation', () => {
  assert.equal(
    protocol.searchPacket().toString('hex'),
    'fdfd021044454641554c545f444556494345494400017c3005',
  );
});

test('status packet matches the reference implementation', () => {
  assert.equal(
    protocol.statusPacket(DEVICE).toString('hex'),
    'fdfd02103132333435363738393031323334353604313131310101b702444a8864257606',
  );
});

test('firmware packet matches the reference implementation', () => {
  assert.equal(
    protocol.firmwarePacket(DEVICE).toString('hex'),
    'fdfd02103132333435363738393031323334353604313131310186b95c05',
  );
});

test('on and off packets match the reference implementation', () => {
  assert.equal(
    protocol.onOffPacket(DEVICE, true).toString('hex'),
    'fdfd02103132333435363738393031323334353604313131310301012104',
  );
  assert.equal(
    protocol.onOffPacket(DEVICE, false).toString('hex'),
    'fdfd02103132333435363738393031323334353604313131310301002004',
  );
});

test('speed packets match the reference implementation', () => {
  assert.equal(
    protocol.speedPacket(DEVICE, protocol.SPEED.LOW).toString('hex'),
    'fdfd02103132333435363738393031323334353604313131310302012204',
  );
  assert.equal(
    protocol.speedPacket(DEVICE, protocol.SPEED.MANUAL).toString('hex'),
    'fdfd02103132333435363738393031323334353604313131310302ff2005',
  );
});

test('manual speed and mode packets match the reference implementation', () => {
  assert.equal(
    protocol.manualSpeedPacket(DEVICE, 128).toString('hex'),
    'fdfd0210313233343536373839303132333435360431313131034480e304',
  );
  assert.equal(
    protocol.modePacket(DEVICE, protocol.MODE.INOUT).toString('hex'),
    'fdfd021031323334353637383930313233343536043131313103b701d704',
  );
});

test('reset filter packet matches the reference implementation', () => {
  assert.equal(
    protocol.resetFilterPacket(DEVICE).toString('hex'),
    'fdfd021031323334353637383930313233343536043131313102658304',
  );
});

test('parses a status response', () => {
  const packet = protocol.parseResponse(
    Buffer.from(
      'fdfd0210313233343536373839303132333435360431313131060101b70102ff44804ab00488016400005a252d3809',
      'hex',
    ),
  );

  assert.ok(packet);
  assert.equal(packet.deviceId, '1234567890123456');
  assert.equal(packet.isOn, true);
  assert.equal(packet.speed, protocol.SPEED.MANUAL);
  assert.equal(packet.manualSpeed, 128);
  assert.equal(packet.fanRpm, 1200);
  assert.equal(packet.mode, protocol.MODE.INOUT);
  assert.equal(packet.filterAlarm, true);
  assert.equal(packet.filterTimer, 129600);
  assert.equal(packet.humidity, 45);
});

test('parses a search response', () => {
  const packet = protocol.parseResponse(
    Buffer.from('fdfd02103132333435363738393031323334353600067c363534333231303938373635343332311807', 'hex'),
  );

  assert.ok(packet);
  assert.equal(packet.searchDeviceId, '6543210987654321');
});

test('parses a firmware response', () => {
  const packet = protocol.parseResponse(
    Buffer.from('fdfd0210313233343536373839303132333435360431313131068601020f0be807b902077606', 'hex'),
  );

  assert.ok(packet);
  assert.equal(packet.firmwareVersion, '1.2');
  assert.equal(packet.firmwareDate, '15-11-2024');
  assert.equal(packet.unitType, 2);
});

test('an off response reports speed OFF', () => {
  const response = buildResponse(DEVICE.id, DEVICE.password, [0x01, 0x00, 0x02, 0x03]);
  const packet = protocol.parseResponse(response);

  assert.ok(packet);
  assert.equal(packet.isOn, false);
  assert.equal(packet.speed, protocol.SPEED.OFF);
});

test('rejects a response with a bad checksum', () => {
  const response = buildResponse(DEVICE.id, DEVICE.password, [0x01, 0x01]);
  response[response.length - 1] ^= 0xff;

  assert.equal(protocol.parseResponse(response), null);
});

test('rejects a packet with a bad header', () => {
  const response = buildResponse(DEVICE.id, DEVICE.password, [0x01, 0x01]);
  response[0] = 0x00;

  assert.equal(protocol.parseResponse(response), null);
});

test('ignores trailing packets that are too short', () => {
  assert.equal(protocol.parseResponse(Buffer.from([0xfd, 0xfd, 0x02])), null);
  assert.equal(protocol.parseResponse(null), null);
});

test('smart 0x06 and 0x24 use the smart parameter sizes', () => {
  const { smartStatusResponse } = require('./helpers');
  const packet = protocol.parseResponse(smartStatusResponse('1234567890123456'), {
    family: 'smart',
  });

  assert.ok(packet);
  assert.equal(packet.isOn, true);
  assert.equal(packet.boostTimer, 900);
  assert.equal(packet.turnOnDelay, 0);
});

test('smart 0x20 is the silent window end, not a temperature', () => {
  const response = buildResponse('1234567890123456', '1111', [
    0xfe, 0x03, 0x20, 0xdc, 0x50, 0x00,
    0x31, 0x0e,
  ]);
  const packet = protocol.parseResponse(response, { family: 'smart' });

  assert.ok(packet);
  assert.equal(packet.silentEndSeconds, 20700);
  assert.equal(packet.temperature, 14);
});

test('parses the extended smart fan parameter set', () => {
  const response = buildResponse('1234567890123456', '1111', [
    0x08, 0x01,
    0x0a, 0x00,
    0x0b, 0x01,
    0x0c, 0x00,
    0x0d, 0x01,
    0x0e, 0x00,
    0x0f, 0x01,
    0x11, 0x00,
    0x12, 0x02,
    0x13, 0x00,
    0x14, 0x4c,
    0x16, 0x18,
    0x1b, 0x46,
    0x1e, 0x01,
    0xfe, 0x03, 0x1f, 0x60, 0x35, 0x01,
    0xfe, 0x03, 0x20, 0xdc, 0x50, 0x00,
    0xfe, 0x03, 0x21, 0x3f, 0xdb, 0x00,
    0x2e, 0x35,
    0x31, 0x0e,
  ]);
  const packet = protocol.parseResponse(response, { family: 'smart' });

  assert.ok(packet);
  assert.equal(packet.humidityRunning, true);
  assert.equal(packet.temperatureRunning, false);
  assert.equal(packet.motionRunning, true);
  assert.equal(packet.switchRunning, false);
  assert.equal(packet.intervalRunning, true);
  assert.equal(packet.silentRunning, false);
  assert.equal(packet.humidityMode, 1);
  assert.equal(packet.temperatureMode, 0);
  assert.equal(packet.motionMode, 2);
  assert.equal(packet.switchMode, 0);
  assert.equal(packet.humiditySetpoint, 76);
  assert.equal(packet.temperatureSetpoint, 24);
  assert.equal(packet.intervalPercentage, 70);
  assert.equal(packet.silentActive, true);
  assert.equal(packet.silentStartSeconds, 79200);
  assert.equal(packet.silentEndSeconds, 20700);
  assert.equal(packet.clockSeconds, 56127);
  assert.equal(packet.humidity, 53);
  assert.equal(packet.temperature, 14);
});

test('S6W 0x06 and 0x24 use the S6W parameter sizes', () => {
  const response = buildResponse('1234567890123456', '1111', [
    0x06,
    0x00,
    0x24,
    0x34,
    0x12,
    0x01,
    0x01,
  ]);
  const packet = protocol.parseResponse(response, { family: 's6w' });

  assert.ok(packet);
  assert.equal(packet.isOn, true);
  assert.equal(packet.boostActive, false);
  assert.equal(packet.rtcBattery, 0x1234);
});

test('parses the full S6W parameter set, including page 3', () => {
  const parameters = [
    0x01, 0x01,
    0xb7, 0x01,
    0x02, 0x01,
    0x44, 0xcc,
    0x4a, 0x48, 0x03,
    0x88, 0x00,
    0x64, 0x00, 0x00, 0x5a,
    0x25, 0x33,
    0x06, 0x00,
    0x07, 0x00,
    0xfe, 0x03, 0x0b, 0x00, 0x00, 0x00,
    0x0f, 0x01,
    0x14, 0x00,
    0x16, 0x00,
    0x19, 0x46,
    0x2d, 0x00,
    0x32, 0x00,
    0x3a, 0x17,
    0x3b, 0x12,
    0x3c, 0x71,
    0x3d, 0x65,
    0x3e, 0xb5,
    0x3f, 0xa4,
    0xfe, 0x02, 0x63, 0x6d, 0x01,
    0x66, 0x1e,
    0xfe, 0x02, 0x24, 0xf6, 0x0a,
    0x72, 0x00,
    0x83, 0x00,
    0xb8, 0x32,
    0xff, 0x03,
    0xfe, 0x02, 0x02, 0x00, 0x08,
    0xfe, 0x02, 0x03, 0x00, 0x04,
    0x04, 0x00,
    0x05, 0x00,
  ];

  const packet = protocol.parseResponse(
    buildResponse('1234567890123456', '1111', parameters),
    { family: 's6w' },
  );

  assert.ok(packet);
  assert.equal(packet.isOn, true);
  assert.equal(packet.mode, protocol.MODE.INOUT);
  assert.equal(packet.speed, protocol.SPEED.LOW);
  assert.equal(packet.manualSpeed, 204);
  assert.equal(packet.fanRpm, 840);
  assert.equal(packet.humidity, 51);
  assert.equal(packet.timerMode, protocol.TIMER_MODE.OFF);
  assert.equal(packet.timerSeconds, 0);
  assert.equal(packet.humiditySensor, 1);
  assert.equal(packet.humidityThreshold, 70);
  assert.equal(packet.analogThreshold, 50);
  assert.equal(packet.analogLevel, 0);
  assert.equal(packet.relayActive, false);
  assert.equal(packet.supplySpeed1, 23);
  assert.equal(packet.exhaustSpeed1, 18);
  assert.equal(packet.supplySpeed2, 113);
  assert.equal(packet.exhaustSpeed2, 101);
  assert.equal(packet.supplySpeed3, 181);
  assert.equal(packet.exhaustSpeed3, 164);
  assert.equal(packet.filterInterval, 365);
  assert.equal(packet.boostDelay, 30);
  assert.equal(packet.rtcBattery, 2806);
  assert.equal(packet.schedule, false);
  assert.equal(packet.alarm, 0);
  assert.equal(packet.nightMinutes, 0);
  assert.equal(packet.nightHours, 8);
  assert.equal(packet.partyMinutes, 0);
  assert.equal(packet.partyHours, 4);
  assert.equal(packet.humidityOver, false);
  assert.equal(packet.analogOver, false);
  assert.deepEqual(packet.missing, []);
});

test('records parameters the unit does not support', () => {
  const response = buildResponse('1234567890123456', '1111', [
    0x01,
    0x01,
    0xfd,
    0x3a,
    0xfd,
    0x3b,
    0x02,
    0x01,
  ]);
  const packet = protocol.parseResponse(response, { family: 's6w' });

  assert.ok(packet);
  assert.equal(packet.speed, protocol.SPEED.LOW);
  assert.deepEqual(packet.missing, [protocol.P.SUPPLY_SPEED_1, protocol.P.EXHAUST_SPEED_1]);
});

test('writes timer mode, schedule and page 3 durations', () => {
  assert.deepEqual(protocol.parameterBytes([{ number: protocol.P.TIMER_MODE, value: 1 }]), [
    0x07,
    0x01,
  ]);
  assert.deepEqual(protocol.parameterBytes([{ number: protocol.P.SCHEDULE, value: 1 }]), [
    0x72,
    0x01,
  ]);
  assert.deepEqual(
    protocol.parameterBytes([
      { number: protocol.P.NIGHT_DURATION, value: [30, 8] },
      { number: protocol.P.PARTY_DURATION, value: [0, 4] },
    ]),
    [0xff, 0x03, 0xfe, 0x02, 0x02, 0x1e, 0x08, 0xfe, 0x02, 0x03, 0x00, 0x04],
  );
});

test('writes sensor, threshold, filter and stage settings', () => {
  assert.deepEqual(
    protocol.parameterBytes([{ number: protocol.P.HUMIDITY_SENSOR, value: true }]),
    [0x0f, 0x01],
  );
  assert.deepEqual(
    protocol.parameterBytes([{ number: protocol.P.HUMIDITY_THRESHOLD, value: 70 }]),
    [0x19, 0x46],
  );
  assert.deepEqual(
    protocol.parameterBytes([{ number: protocol.P.ANALOG_THRESHOLD, value: 50 }]),
    [0xb8, 0x32],
  );
  assert.deepEqual(
    protocol.parameterBytes([{ number: protocol.P.BOOST_DELAY, value: 30 }]),
    [0x66, 0x1e],
  );
  assert.deepEqual(
    protocol.parameterBytes([{ number: protocol.P.FILTER_INTERVAL, value: 365 }]),
    [0xfe, 0x02, 0x63, 0x6d, 0x01],
  );
  assert.deepEqual(
    protocol.parameterBytes([{ number: protocol.P.SUPPLY_SPEED_1, value: 23 }]),
    [0x3a, 0x17],
  );
});

test('reads and writes a weekly schedule entry', () => {
  assert.deepEqual(
    protocol.parameterBytes([{ number: protocol.P.SCHEDULE_ENTRY, value: [1, 2] }]),
    [0xfe, 0x02, 0x77, 0x01, 0x02],
  );

  const entry = protocol.scheduleEntryWritePacket(DEVICE, {
    weekday: 1,
    period: 2,
    speed: 1,
    minutes: 0,
    hours: 9,
  });
  assert.deepEqual(
    entry.subarray(entry.length - 11, entry.length - 2),
    Buffer.from([0xfe, 0x06, 0x77, 0x01, 0x02, 0x01, 0x00, 0x00, 0x09]),
  );

  const response = buildResponse('1234567890123456', '1111', [
    0xfe,
    0x06,
    0x77,
    0x01,
    0x02,
    0x01,
    0x00,
    0x00,
    0x09,
  ]);
  const packet = protocol.parseResponse(response, { family: 's6w' });
  assert.ok(packet);
  assert.deepEqual(packet.scheduleEntry, {
    weekday: 1,
    period: 2,
    speed: 1,
    reserved: 0,
    minutes: 0,
    hours: 9,
  });
});

test('reads several schedule entries from one response', () => {
  const response = buildResponse('1234567890123456', '1111', [
    0xfe, 0x06, 0x77, 0x01, 0x01, 0x01, 0x0f, 0x00, 0x06,
    0xfe, 0x06, 0x77, 0x01, 0x02, 0x01, 0x00, 0x00, 0x09,
    0xfe, 0x06, 0x77, 0x02, 0x01, 0x00, 0x00, 0x17, 0x1e,
  ]);
  const packet = protocol.parseResponse(response, { family: 's6w' });

  assert.ok(packet);
  assert.equal(packet.scheduleEntries.length, 3);
  assert.deepEqual(packet.scheduleEntries[2], {
    weekday: 2,
    period: 1,
    speed: 0,
    reserved: 0,
    minutes: 23,
    hours: 30,
  });
});

test('readHeader exposes the device and the parameter offset', () => {
  const response = buildResponse('1234567890123456', '1111', [0x01, 0x01]);
  const header = protocol.readHeader(response);

  assert.ok(header);
  assert.equal(header.deviceId, '1234567890123456');
  assert.equal(header.func, protocol.FUNC.RESPONSE);
  assert.ok(header.dataOffset > 3);
});
