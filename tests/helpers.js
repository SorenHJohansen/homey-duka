'use strict';

const { EventEmitter } = require('node:events');

const protocol = require('../lib/duka-protocol');

function buildResponse(deviceId, parameters, password = '1111') {
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

function firmwareResponse(deviceId, unitType) {
  return buildResponse(deviceId, [
    0xfe,
    0x06,
    0x86,
    0x02,
    0x02,
    0x10,
    0x06,
    0xe6,
    0x07,
    0xfe,
    0x02,
    0xb9,
    unitType,
    0x00,
  ]);
}

function searchResponse(deviceId, searchId, unitType = null) {
  const parameters = [0x7c];
  for (const char of searchId.padEnd(16, '0').slice(0, 16)) parameters.push(char.charCodeAt(0));
  if (unitType !== null) parameters.push(0xfe, 0x02, 0xb9, unitType, 0x00);
  return buildResponse(deviceId, parameters);
}

function s6wStatusResponse(deviceId) {
  return buildResponse(deviceId, [
    0x01,
    0x01,
    0xb7,
    0x01,
    0x02,
    0x02,
    0x44,
    0x80,
    0x4a,
    0xb0,
    0x04,
    0x88,
    0x00,
    0x64,
    0x00,
    0x00,
    0x5a,
    0x25,
    0x37,
  ]);
}

function smartStatusResponse(deviceId) {
  return buildResponse(deviceId, [
    0x01,
    0x01,
    0x03,
    0x00,
    0x04,
    0x00,
    0x00,
    0x05,
    0x00,
    0x06,
    0x84,
    0x03,
    0x00,
    0x07,
    0x00,
    0x0f,
    0x02,
    0x11,
    0x00,
    0x13,
    0x00,
    0x14,
    0x4c,
    0x16,
    0x18,
    0x18,
    0x4a,
    0x1a,
    0x55,
    0x1d,
    0x00,
    0x23,
    0x03,
    0x24,
    0x00,
    0x2e,
    0x3d,
    0x31,
    0x14,
  ]);
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.port = 4000;
    this.sent = [];
    this.closed = false;
    this.onSend = null;
  }

  bind(port) {
    this.port = port || 4000;
    setImmediate(() => this.emit('listening'));
  }

  setBroadcast() {}

  address() {
    return { port: this.port };
  }

  send(packet, offset, length, port, address, callback) {
    const buffer = Buffer.from(packet);
    this.sent.push({ packet: buffer, address, port });
    setImmediate(() => {
      callback(null);
      if (this.onSend) this.onSend(buffer, address);
    });
  }

  close() {
    this.closed = true;
  }

  message(buffer, address = '192.0.2.10') {
    this.emit('message', buffer, { address, port: 4000 });
  }
}

module.exports = {
  FakeSocket,
  buildResponse,
  firmwareResponse,
  searchResponse,
  s6wStatusResponse,
  smartStatusResponse,
};
