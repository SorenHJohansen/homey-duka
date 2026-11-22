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
});

test('readHeader exposes the device and the parameter offset', () => {
  const response = buildResponse('1234567890123456', '1111', [0x01, 0x01]);
  const header = protocol.readHeader(response);

  assert.ok(header);
  assert.equal(header.deviceId, '1234567890123456');
  assert.equal(header.func, protocol.FUNC.RESPONSE);
  assert.ok(header.dataOffset > 3);
});
