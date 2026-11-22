'use strict';

/**
 * Packet encoding and decoding for the DUKA UDP protocol.
 *
 * The protocol is documented by the reverse engineered Home Assistant
 * integration (github.com/dingusdk/ha-duka) and its Python SDK
 * `dukasdk`. Packets are sent to UDP port 4000 and consist of:
 *
 *   0xFD 0xFD 0x02 | id length | device id | password length | password
 *   | function | parameter... | checksum (little endian uint16)
 *
 * The checksum is the sum of every byte after the two 0xFD bytes, up to and
 * excluding the checksum itself.
 */

const FUNC = Object.freeze({
  READ: 1,
  WRITE: 2,
  WRITEREAD: 3,
  INCREAD: 4,
  DECREAD: 5,
  RESPONSE: 6,
});

const PARAM = Object.freeze({
  ON_OFF: 0x01,
  SPEED: 0x02,
  MODE_24H: 0x03,
  FAN_RPM: 0x04,
  BOOST: 0x05,
  BOOST_TIMER: 0x06,
  BOOST_FLAG: 0x07,
  HUMIDITY_MODE: 0x0f,
  TEMPERATURE_SENSOR: 0x11,
  MOTION_SENSOR: 0x13,
  HUMIDITY_THRESHOLD: 0x14,
  TEMPERATURE_THRESHOLD: 0x16,
  MAX_SPEED: 0x18,
  SILENT_SPEED: 0x1a,
  INTERVAL: 0x1d,
  TURN_OFF_DELAY: 0x23,
  TURN_ON_DELAY: 0x24,
  CURRENT_HUMIDITY: 0x25,
  SMART_HUMIDITY: 0x2e,
  SMART_TEMPERATURE: 0x31,
  TEMPERATURE_DECIMALS: 0x20,
  MANUAL_SPEED: 0x44,
  FAN1_RPM: 0x4a,
  FILTER_TIMER: 0x64,
  RESET_FILTER_TIMER: 0x65,
  SEARCH: 0x7c,
  RESET_ALARMS: 0x80,
  READ_ALARM: 0x83,
  READ_FIRMWARE_VERSION: 0x86,
  FILTER_ALARM: 0x88,
  VENTILATION_MODE: 0xb7,
  UNIT_TYPE: 0xb9,
});

const SPEED = Object.freeze({
  OFF: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  MANUAL: 255,
});

const MODE = Object.freeze({
  OUT: 0,
  INOUT: 1,
  IN: 2,
});

// Size in bytes of each parameter value in a response.
const PARAM_SIZES = Object.freeze({
  0x01: 1, // on/off
  0x02: 1, // speed
  0x03: 1, // 24 hour mode
  0x04: 2, // fan rpm (smart fan)
  0x05: 1, // boost
  0x06: 1, // boot mode (S6W); the smart fan boost timer uses 3 bytes
  0x07: 1, // boost flag
  0x0b: 3, // timer countdown
  0x0f: 1, // humidity mode / humidity sensor activation
  0x11: 1, // temperature sensor
  0x13: 1, // motion sensor
  0x14: 1, // humidity threshold / relay sensor activation
  0x16: 1, // temperature threshold / 0-10v sensor activation
  0x18: 1, // max speed setting
  0x19: 1, // humidity threshold
  0x1a: 1, // silent speed setting
  0x1b: 1,
  0x1d: 1, // interval ventilation
  0x1e: 1,
  0x1f: 3,
  0x20: 3, // temperature with decimals (smart fan)
  0x21: 3,
  0x23: 1, // turn-off delay
  0x24: 2, // RTC battery voltage (S6W); the smart fan turn-on delay uses 1 byte
  0x25: 1, // current humidity (S6W)
  0x2d: 1, // current 0-10v sensor
  0x2e: 1, // current humidity (smart fan)
  0x31: 1, // current temperature (smart fan)
  0x32: 1, // current relay sensor state
  0x44: 1, // manual speed
  0x4a: 2, // fan 1 rpm
  0x4b: 2, // fan 2 rpm
  0x64: 3, // filter timer: minutes, hours, days
  0x65: 1, // reset filter timer
  0x66: 1, // boost mode deactivation delay
  0x6f: 3, // RTC time
  0x70: 4, // RTC calendar
  0x72: 1, // weekly schedule
  0x77: 6, // schedule setup
  0x7c: 16, // device search
  0x7d: 0, // device password
  0x7e: 4, // machine hours
  0x80: 1, // reset alarms
  0x83: 1, // alarm indicator
  0x85: 1, // cloud permission
  0x86: 6, // firmware version and date
  0x87: 1, // factory reset
  0x88: 1, // filter replacement
  0x94: 1, // wifi mode
  0x95: 0, // wifi name
  0x96: 0, // wifi password
  0x99: 1, // wifi encryption
  0x9a: 1, // wifi channel
  0x9b: 1, // wifi dhcp
  0x9c: 4, // ip address
  0x9d: 4, // subnet mask
  0x9e: 4, // gateway
  0xb7: 1, // ventilation mode
  0xb9: 2, // unit type
});

// The smart fan reuses 0x06 and 0x24 with different meanings and sizes.
const SMART_PARAM_SIZES = Object.freeze({
  ...PARAM_SIZES,
  0x06: 3, // boost timer
  0x24: 1, // turn-on delay
});

const SEARCH_DEVICE_ID = 'DEFAULT_DEVICEID';

const S6W_STATUS_PARAMS = [
  PARAM.ON_OFF,
  PARAM.VENTILATION_MODE,
  PARAM.SPEED,
  PARAM.MANUAL_SPEED,
  PARAM.FAN1_RPM,
  PARAM.FILTER_ALARM,
  PARAM.FILTER_TIMER,
  PARAM.CURRENT_HUMIDITY,
];

// Parameters reported by the smart fan firmware (unit type 6).
const SMART_STATUS_PARAMS = [
  PARAM.ON_OFF,
  PARAM.MODE_24H,
  PARAM.FAN_RPM,
  PARAM.BOOST,
  PARAM.BOOST_TIMER,
  PARAM.BOOST_FLAG,
  PARAM.HUMIDITY_MODE,
  PARAM.TEMPERATURE_SENSOR,
  PARAM.MOTION_SENSOR,
  PARAM.HUMIDITY_THRESHOLD,
  PARAM.TEMPERATURE_THRESHOLD,
  PARAM.MAX_SPEED,
  PARAM.SILENT_SPEED,
  PARAM.INTERVAL,
  PARAM.TURN_OFF_DELAY,
  PARAM.TURN_ON_DELAY,
  PARAM.SMART_HUMIDITY,
  PARAM.SMART_TEMPERATURE,
  PARAM.TEMPERATURE_DECIMALS,
];

function checksum(buffer) {
  let sum = 0;
  for (let i = 2; i < buffer.length; i += 1) sum += buffer[i];
  return sum & 0xffff;
}

function buildPacket(deviceId, password, func, parameters = []) {
  const id = Buffer.from(String(deviceId), 'ascii');
  const pass = Buffer.from(String(password), 'ascii');
  const body = Buffer.concat([
    Buffer.from([0xfd, 0xfd, 0x02, id.length]),
    id,
    Buffer.from([pass.length]),
    pass,
    Buffer.from([func]),
    Buffer.from(parameters),
  ]);
  const tail = Buffer.alloc(2);
  tail.writeUInt16LE(checksum(body), 0);
  return Buffer.concat([body, tail]);
}

function searchPacket() {
  return buildPacket(SEARCH_DEVICE_ID, '', FUNC.READ, [PARAM.SEARCH]);
}

function statusPacket(device) {
  return buildPacket(device.id, device.password, FUNC.READ, S6W_STATUS_PARAMS);
}

function smartStatusPacket(device) {
  return buildPacket(device.id, device.password, FUNC.READ, SMART_STATUS_PARAMS);
}

function smartSettingPacket(device, parameter, value) {
  return buildPacket(device.id, device.password, FUNC.WRITEREAD, [parameter, value]);
}

function firmwarePacket(device) {
  return buildPacket(device.id, device.password, FUNC.READ, [
    PARAM.READ_FIRMWARE_VERSION,
    PARAM.UNIT_TYPE,
  ]);
}

function onOffPacket(device, on) {
  return buildPacket(device.id, device.password, FUNC.WRITEREAD, [
    PARAM.ON_OFF,
    on ? 0x01 : 0x00,
  ]);
}

function speedPacket(device, speed) {
  return buildPacket(device.id, device.password, FUNC.WRITEREAD, [PARAM.SPEED, speed]);
}

function manualSpeedPacket(device, speed) {
  return buildPacket(device.id, device.password, FUNC.WRITEREAD, [
    PARAM.MANUAL_SPEED,
    Math.max(0, Math.min(255, Math.round(speed))),
  ]);
}

function modePacket(device, mode) {
  return buildPacket(device.id, device.password, FUNC.WRITEREAD, [PARAM.VENTILATION_MODE, mode]);
}

function resetFilterPacket(device) {
  return buildPacket(device.id, device.password, FUNC.WRITE, [PARAM.RESET_FILTER_TIMER]);
}

function cleanString(value) {
  return String(value).replace(/\0+$/, '').trim();
}

function readHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return null;
  if (buffer[0] !== 0xfd || buffer[1] !== 0xfd || buffer[2] !== 0x02) return null;
  if (checksum(buffer.subarray(0, buffer.length - 2)) !== buffer.readUInt16LE(buffer.length - 2)) {
    return null;
  }

  let pos = 3;
  const readByte = () => {
    if (pos >= buffer.length) throw new RangeError('Unexpected end of packet');
    const value = buffer[pos];
    pos += 1;
    return value;
  };
  const readString = () => {
    const length = readByte();
    if (pos + length > buffer.length) throw new RangeError('Unexpected end of packet');
    const value = buffer.toString('ascii', pos, pos + length);
    pos += length;
    return value;
  };

  try {
    const deviceId = readString();
    const password = readString();
    const func = readByte();
    return { deviceId, password, func, dataOffset: pos };
  } catch (err) {
    return null;
  }
}

function parseResponse(buffer, options = {}) {
  const header = readHeader(buffer);
  if (!header || header.func !== FUNC.RESPONSE) return null;

  const sizes = options.family === 'smart' ? SMART_PARAM_SIZES : PARAM_SIZES;
  let pos = header.dataOffset;

  const readByte = () => {
    if (pos >= buffer.length) throw new RangeError('Unexpected end of packet');
    const value = buffer[pos];
    pos += 1;
    return value;
  };

  const result = {
    deviceId: header.deviceId,
    password: header.password,
    isOn: null,
    speed: null,
    manualSpeed: null,
    fanRpm: null,
    humidity: null,
    mode: null,
    filterAlarm: null,
    filterTimer: null,
    searchDeviceId: null,
    firmwareVersion: null,
    firmwareDate: null,
    unitType: null,
    rpm: null,
    temperature: null,
    temperatureDecimals: null,
    boost: null,
    boostTimer: null,
    boostFlag: null,
    mode24h: null,
    interval: null,
    maxSpeed: null,
    silentSpeed: null,
    humidityMode: null,
    humidityThreshold: null,
    temperatureThreshold: null,
    turnOffDelay: null,
    turnOnDelay: null,
    temperatureSensor: null,
    motionSensor: null,
  };

  try {
    // A parameter needs at least an id and one value byte, and the packet
    // always ends with a two byte checksum.
    while (pos + 4 <= buffer.length) {
      let parameter = readByte();
      let size = 1;

      if (parameter === 0xfe) {
        size = readByte();
        parameter = readByte();
      } else if (parameter in sizes) {
        size = sizes[parameter];
      }

      if (pos + size > buffer.length - 2) break;
      const start = pos;

      switch (parameter) {
        case PARAM.ON_OFF:
          result.isOn = buffer[start] !== 0;
          break;
        case PARAM.SPEED:
          result.speed = buffer[start];
          break;
        case PARAM.MANUAL_SPEED:
          result.manualSpeed = buffer[start];
          break;
        case PARAM.FAN1_RPM:
          result.fanRpm = buffer[start] + (buffer[start + 1] << 8);
          break;
        case PARAM.CURRENT_HUMIDITY:
          result.humidity = buffer[start];
          break;
        case PARAM.VENTILATION_MODE:
          result.mode = buffer[start];
          break;
        case PARAM.READ_FIRMWARE_VERSION:
          result.firmwareVersion = `${buffer[start]}.${buffer[start + 1]}`;
          result.firmwareDate =
            `${buffer[start + 2]}-${buffer[start + 3]}-` +
            `${buffer[start + 4] + (buffer[start + 5] << 8)}`;
          break;
        case PARAM.UNIT_TYPE:
          result.unitType = buffer[start];
          break;
        case PARAM.FILTER_ALARM:
          result.filterAlarm = buffer[start] !== 0;
          break;
        case PARAM.FILTER_TIMER:
          result.filterTimer =
            buffer[start] + (buffer[start + 2] * 24 + buffer[start + 1]) * 60;
          break;
        case PARAM.SEARCH:
          result.searchDeviceId = cleanString(buffer.toString('ascii', start, start + 16));
          break;
        case PARAM.MODE_24H:
          result.mode24h = buffer[start] !== 0;
          break;
        case PARAM.FAN_RPM:
          result.rpm = buffer[start] + (buffer[start + 1] << 8);
          break;
        case PARAM.BOOST:
          result.boost = buffer[start] !== 0;
          break;
        case PARAM.BOOST_TIMER:
          result.boostTimer = buffer[start] + (buffer[start + 1] << 8) + (buffer[start + 2] << 16);
          break;
        case PARAM.BOOST_FLAG:
          result.boostFlag = buffer[start] !== 0;
          break;
        case PARAM.HUMIDITY_MODE:
          result.humidityMode = buffer[start];
          break;
        case PARAM.TEMPERATURE_SENSOR:
          result.temperatureSensor = buffer[start] !== 0;
          break;
        case PARAM.MOTION_SENSOR:
          result.motionSensor = buffer[start] !== 0;
          break;
        case PARAM.HUMIDITY_THRESHOLD:
          result.humidityThreshold = buffer[start];
          break;
        case PARAM.TEMPERATURE_THRESHOLD:
          result.temperatureThreshold = buffer[start];
          break;
        case PARAM.MAX_SPEED:
          result.maxSpeed = buffer[start];
          break;
        case PARAM.SILENT_SPEED:
          result.silentSpeed = buffer[start];
          break;
        case PARAM.INTERVAL:
          result.interval = buffer[start] !== 0;
          break;
        case PARAM.TURN_OFF_DELAY:
          result.turnOffDelay = buffer[start];
          break;
        case PARAM.TURN_ON_DELAY:
          result.turnOnDelay = buffer[start];
          break;
        case PARAM.SMART_HUMIDITY:
          result.humidity = buffer[start];
          break;
        case PARAM.SMART_TEMPERATURE:
          result.temperature = buffer[start];
          break;
        case PARAM.TEMPERATURE_DECIMALS:
          result.temperatureDecimals =
            (buffer[start] + (buffer[start + 1] << 8) + (buffer[start + 2] << 16)) / 1000;
          break;
        default:
          break;
      }

      pos += size;
    }
  } catch (err) {
    return null;
  }

  if (result.isOn === false) result.speed = SPEED.OFF;

  return result;
}

module.exports = {
  FUNC,
  PARAM,
  SPEED,
  MODE,
  PARAM_SIZES,
  SMART_PARAM_SIZES,
  checksum,
  readHeader,
  buildPacket,
  searchPacket,
  statusPacket,
  smartStatusPacket,
  smartSettingPacket,
  firmwarePacket,
  onOffPacket,
  speedPacket,
  manualSpeedPacket,
  modePacket,
  resetFilterPacket,
  parseResponse,
};
