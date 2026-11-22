'use strict';

/**
 * Packet encoding and decoding for the DUKA UDP protocol.
 *
 * The protocol is documented by the reverse engineered Home Assistant
 * integration (github.com/dingusdk/ha-dukaone) and its Python SDK
 * `dukaonesdk`. The parameter list follows the manufacturer's Smart Home
 * connection guide (Blauberg VENTO, which the DUKA units follow). Packets are
 * sent to UDP port 4000 and consist of:
 *
 *   0xFD 0xFD 0x02 | id length | device id | password length | password
 *   | function | parameter... | checksum (little endian uint16)
 *
 * The checksum is the sum of every byte after the two 0xFD bytes, up to and
 * excluding the checksum itself.
 *
 * Parameters carry a two byte number: a page and a lead byte. Page 0 is the
 * default. Markers inside the data block are:
 *
 *   0xFF page       the following parameters are on this page
 *   0xFE size       the next parameter's value is `size` bytes
 *   0xFD lead       the unit does not support that parameter
 *   0xFC function   the function changes from here
 */

const FUNC = Object.freeze({
  READ: 1,
  WRITE: 2,
  WRITEREAD: 3,
  INCREAD: 4,
  DECREAD: 5,
  RESPONSE: 6,
});

const MARKER = Object.freeze({
  PAGE: 0xff,
  SIZE: 0xfe,
  NOT_SUPPORTED: 0xfd,
  FUNCTION: 0xfc,
});

// Parameters of the smart fan and the S6W share numbers with different
// meanings, so the decoders take the family into account.
const PARAM = Object.freeze({
  ON_OFF: 0x01,
  BATTERY: 0x02,
  SPEED: 0x02,
  MODE_24H: 0x03,
  FAN_RPM: 0x04,
  BOOST: 0x05,
  BOOST_TIMER: 0x06,
  BOOST_FLAG: 0x07,
  HUMIDITY_RUNNING: 0x08,
  TEMPERATURE_RUNNING: 0x0a,
  MOTION_RUNNING: 0x0b,
  SWITCH_RUNNING: 0x0c,
  INTERVAL_RUNNING: 0x0d,
  SILENT_RUNNING: 0x0e,
  HUMIDITY_MODE: 0x0f,
  TEMPERATURE_MODE: 0x11,
  MOTION_MODE: 0x12,
  SWITCH_MODE: 0x13,
  HUMIDITY_SETPOINT: 0x14,
  TEMPERATURE_SETPOINT: 0x16,
  MAX_SPEED: 0x18,
  SILENT_SPEED: 0x1a,
  INTERVAL_PERCENTAGE: 0x1b,
  INTERVAL: 0x1d,
  SILENT_ACTIVE: 0x1e,
  SILENT_START: 0x1f,
  SILENT_END: 0x20,
  CLOCK: 0x21,
  TURN_OFF_DELAY: 0x23,
  TURN_ON_DELAY: 0x24,
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
  CURRENT_HUMIDITY: 0x25,
});

// Full parameter numbers: the page in the high byte, the lead byte low.
const P = Object.freeze({
  POWER: 0x0001,
  SPEED: 0x0002,
  BOOST_STATUS: 0x0006,
  TIMER_MODE: 0x0007,
  TIMER_COUNTDOWN: 0x000b,
  HUMIDITY_SENSOR: 0x000f,
  RELAY_SENSOR: 0x0014,
  ANALOG_SENSOR: 0x0016,
  HUMIDITY_THRESHOLD: 0x0019,
  RTC_BATTERY: 0x0024,
  HUMIDITY: 0x0025,
  ANALOG_LEVEL: 0x002d,
  RELAY_ACTIVE: 0x0032,
  SUPPLY_SPEED_1: 0x003a,
  EXHAUST_SPEED_1: 0x003b,
  SUPPLY_SPEED_2: 0x003c,
  EXHAUST_SPEED_2: 0x003d,
  SUPPLY_SPEED_3: 0x003e,
  EXHAUST_SPEED_3: 0x003f,
  MANUAL_SPEED: 0x0044,
  FAN_RPM: 0x004a,
  FAN2_RPM: 0x004b,
  FILTER_INTERVAL: 0x0063,
  FILTER_TIMER: 0x0064,
  RESET_FILTER: 0x0065,
  BOOST_DELAY: 0x0066,
  RTC_TIME: 0x006f,
  RTC_DATE: 0x0070,
  SCHEDULE: 0x0072,
  SCHEDULE_ENTRY: 0x0077,
  SEARCH: 0x007c,
  MACHINE_HOURS: 0x007e,
  RESET_ALARMS: 0x0080,
  ALARM: 0x0083,
  FIRMWARE: 0x0086,
  FILTER_REPLACE: 0x0088,
  MODE: 0x00b7,
  ANALOG_THRESHOLD: 0x00b8,
  UNIT_TYPE: 0x00b9,
  RESTORE_SPEEDS: 0x012a,
  NIGHT_DURATION: 0x0302,
  PARTY_DURATION: 0x0303,
  HUMIDITY_OVER: 0x0304,
  ANALOG_OVER: 0x0305,
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

const TIMER_MODE = Object.freeze({
  OFF: 0,
  NIGHT: 1,
  PARTY: 2,
});

// Size in bytes of each parameter value in an S6W response.
const S6W_PARAM_SIZES = Object.freeze({
  [P.POWER]: 1,
  [P.SPEED]: 1,
  [P.BOOST_STATUS]: 1,
  [P.TIMER_MODE]: 1,
  [P.TIMER_COUNTDOWN]: 3,
  [P.HUMIDITY_SENSOR]: 1,
  [P.RELAY_SENSOR]: 1,
  [P.ANALOG_SENSOR]: 1,
  [P.HUMIDITY_THRESHOLD]: 1,
  [P.RTC_BATTERY]: 2,
  [P.HUMIDITY]: 1,
  [P.ANALOG_LEVEL]: 1,
  [P.RELAY_ACTIVE]: 1,
  [P.SUPPLY_SPEED_1]: 1,
  [P.EXHAUST_SPEED_1]: 1,
  [P.SUPPLY_SPEED_2]: 1,
  [P.EXHAUST_SPEED_2]: 1,
  [P.SUPPLY_SPEED_3]: 1,
  [P.EXHAUST_SPEED_3]: 1,
  [P.MANUAL_SPEED]: 1,
  [P.FAN_RPM]: 2,
  [P.FAN2_RPM]: 2,
  [P.FILTER_INTERVAL]: 2,
  [P.FILTER_TIMER]: 3,
  [P.RESET_FILTER]: 1,
  [P.BOOST_DELAY]: 1,
  [P.RTC_TIME]: 3,
  [P.RTC_DATE]: 4,
  [P.SCHEDULE]: 1,
  [P.SCHEDULE_ENTRY]: 6,
  [P.SEARCH]: 16,
  [P.MACHINE_HOURS]: 4,
  [P.RESET_ALARMS]: 1,
  [P.ALARM]: 1,
  [P.FIRMWARE]: 6,
  [P.FILTER_REPLACE]: 1,
  [P.MODE]: 1,
  [P.ANALOG_THRESHOLD]: 1,
  [P.UNIT_TYPE]: 2,
  [P.RESTORE_SPEEDS]: 1,
  [P.NIGHT_DURATION]: 2,
  [P.PARTY_DURATION]: 2,
  [P.HUMIDITY_OVER]: 1,
  [P.ANALOG_OVER]: 1,
});

// The smart fan has its own table. The collisions that differ in size are
// 0x06 (boost countdown, 3 bytes), 0x0b (motion run state, 1 byte) and 0x24
// (turn on delay, 1 byte).
const SMART_PARAM_SIZES = Object.freeze({
  ...S6W_PARAM_SIZES,
  [PARAM.BATTERY]: 1,
  [PARAM.MODE_24H]: 1,
  [PARAM.FAN_RPM]: 2,
  [PARAM.BOOST]: 1,
  [PARAM.BOOST_TIMER]: 3,
  [PARAM.HUMIDITY_RUNNING]: 1,
  [PARAM.TEMPERATURE_RUNNING]: 1,
  [PARAM.MOTION_RUNNING]: 1,
  [PARAM.SWITCH_RUNNING]: 1,
  [PARAM.INTERVAL_RUNNING]: 1,
  [PARAM.SILENT_RUNNING]: 1,
  [PARAM.HUMIDITY_MODE]: 1,
  [PARAM.TEMPERATURE_MODE]: 1,
  [PARAM.MOTION_MODE]: 1,
  [PARAM.SWITCH_MODE]: 1,
  [PARAM.MAX_SPEED]: 1,
  [PARAM.SILENT_SPEED]: 1,
  [PARAM.INTERVAL_PERCENTAGE]: 1,
  [PARAM.INTERVAL]: 1,
  [PARAM.SILENT_ACTIVE]: 1,
  [PARAM.SILENT_START]: 3,
  [PARAM.SILENT_END]: 3,
  [PARAM.CLOCK]: 3,
  [PARAM.TURN_ON_DELAY]: 1,
  [PARAM.SMART_HUMIDITY]: 1,
  [PARAM.SMART_TEMPERATURE]: 1,
  [PARAM.TIMER_COUNTDOWN]: 1,
  [PARAM.TURN_OFF_DELAY]: 1,
});

// Kept as the S6W table for callers that import it by name.
const PARAM_SIZES = S6W_PARAM_SIZES;

// The S6W reads every parameter it can, including page 3.
const S6W_STATUS_PARAMS = Object.freeze([
  P.POWER,
  P.MODE,
  P.SPEED,
  P.MANUAL_SPEED,
  P.FAN_RPM,
  P.FILTER_REPLACE,
  P.FILTER_TIMER,
  P.HUMIDITY,
  P.BOOST_STATUS,
  P.TIMER_MODE,
  P.TIMER_COUNTDOWN,
  P.HUMIDITY_SENSOR,
  P.RELAY_SENSOR,
  P.ANALOG_SENSOR,
  P.HUMIDITY_THRESHOLD,
  P.ANALOG_LEVEL,
  P.RELAY_ACTIVE,
  P.SUPPLY_SPEED_1,
  P.EXHAUST_SPEED_1,
  P.SUPPLY_SPEED_2,
  P.EXHAUST_SPEED_2,
  P.SUPPLY_SPEED_3,
  P.EXHAUST_SPEED_3,
  P.FILTER_INTERVAL,
  P.BOOST_DELAY,
  P.RTC_BATTERY,
  P.SCHEDULE,
  P.MACHINE_HOURS,
  P.ALARM,
  P.ANALOG_THRESHOLD,
  P.NIGHT_DURATION,
  P.PARTY_DURATION,
  P.HUMIDITY_OVER,
  P.ANALOG_OVER,
]);

const S6W_STATUS_LOW = Object.freeze([
  PARAM.ON_OFF,
  PARAM.VENTILATION_MODE,
  PARAM.SPEED,
  PARAM.MANUAL_SPEED,
  PARAM.FAN1_RPM,
  PARAM.FILTER_ALARM,
  PARAM.FILTER_TIMER,
  PARAM.CURRENT_HUMIDITY,
]);

// Parameters reported by the smart fan firmware (unit type 6).
const SMART_STATUS_PARAMS = Object.freeze([
  PARAM.ON_OFF,
  PARAM.BATTERY,
  PARAM.MODE_24H,
  PARAM.FAN_RPM,
  PARAM.BOOST,
  PARAM.BOOST_TIMER,
  PARAM.BOOST_FLAG,
  PARAM.HUMIDITY_RUNNING,
  PARAM.TEMPERATURE_RUNNING,
  PARAM.MOTION_RUNNING,
  PARAM.SWITCH_RUNNING,
  PARAM.INTERVAL_RUNNING,
  PARAM.SILENT_RUNNING,
  PARAM.HUMIDITY_MODE,
  PARAM.TEMPERATURE_MODE,
  PARAM.MOTION_MODE,
  PARAM.SWITCH_MODE,
  PARAM.HUMIDITY_SETPOINT,
  PARAM.TEMPERATURE_SETPOINT,
  PARAM.MAX_SPEED,
  PARAM.SILENT_SPEED,
  PARAM.INTERVAL_PERCENTAGE,
  PARAM.INTERVAL,
  PARAM.SILENT_ACTIVE,
  PARAM.SILENT_START,
  PARAM.SILENT_END,
  PARAM.CLOCK,
  PARAM.TURN_OFF_DELAY,
  PARAM.TURN_ON_DELAY,
  PARAM.SMART_HUMIDITY,
  PARAM.SMART_TEMPERATURE,
]);

const SEARCH_DEVICE_ID = 'DEFAULT_DEVICEID';

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

function sizeFor(number, family) {
  const sizes = family === 'smart' ? SMART_PARAM_SIZES : PARAM_SIZES;
  return sizes[number] !== undefined ? sizes[number] : 1;
}

function valueBytes(number, value, family) {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value === 'boolean') return Buffer.from([value ? 1 : 0]);
  const size = sizeFor(number, family);
  const buffer = Buffer.alloc(size);
  buffer.writeUIntLE(Number(value), 0, size);
  return buffer;
}

/**
 * Encode parameters for a request. Each entry is a full parameter number, or
 * `{ number, value }` to attach a value, which is used for writes and for
 * parameters that select an entry, such as the weekly schedule.
 */
function parameterBytes(entries, family) {
  const out = [];
  let page = 0;

  for (const entry of entries) {
    const number = typeof entry === 'number' ? entry : entry.number;
    const value = typeof entry === 'number' ? null : entry.value;
    const entryPage = number >> 8;
    const lead = number & 0xff;

    if (entryPage !== page) {
      out.push(MARKER.PAGE, entryPage);
      page = entryPage;
    }

    if (value === null || value === undefined) {
      out.push(lead);
      continue;
    }

    const bytes = valueBytes(number, value, family);
    if (bytes.length > 1) out.push(MARKER.SIZE, bytes.length);
    out.push(lead, ...bytes);
  }

  return out;
}

function readPacket(device, entries, family) {
  return buildPacket(device.id, device.password, FUNC.READ, parameterBytes(entries, family));
}

function writePacket(device, number, value, family) {
  return buildPacket(
    device.id,
    device.password,
    FUNC.WRITEREAD,
    parameterBytes([{ number, value }], family),
  );
}

function searchPacket() {
  return buildPacket(SEARCH_DEVICE_ID, '', FUNC.READ, [PARAM.SEARCH]);
}

// The eight parameter status packet of the reference implementation.
function statusPacket(device) {
  return buildPacket(device.id, device.password, FUNC.READ, S6W_STATUS_LOW);
}

function s6wStatusPacket(device) {
  return readPacket(device, S6W_STATUS_PARAMS);
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
  return writePacket(device, P.POWER, on ? 1 : 0);
}

function speedPacket(device, speed) {
  return writePacket(device, P.SPEED, speed);
}

function manualSpeedPacket(device, speed) {
  return writePacket(device, P.MANUAL_SPEED, Math.max(0, Math.min(255, Math.round(speed))));
}

function modePacket(device, mode) {
  return writePacket(device, P.MODE, mode);
}

function resetFilterPacket(device) {
  return buildPacket(device.id, device.password, FUNC.WRITE, [PARAM.RESET_FILTER_TIMER]);
}

function timerModePacket(device, mode) {
  return writePacket(device, P.TIMER_MODE, mode);
}

function schedulePacket(device, on) {
  return writePacket(device, P.SCHEDULE, on ? 1 : 0);
}

function sensorPacket(device, number, on) {
  return writePacket(device, number, on ? 1 : 0);
}

function humidityThresholdPacket(device, percent) {
  return writePacket(device, P.HUMIDITY_THRESHOLD, Math.max(40, Math.min(80, Math.round(percent))));
}

function analogThresholdPacket(device, percent) {
  return writePacket(device, P.ANALOG_THRESHOLD, Math.max(5, Math.min(100, Math.round(percent))));
}

function boostDelayPacket(device, minutes) {
  return writePacket(device, P.BOOST_DELAY, Math.max(0, Math.min(60, Math.round(minutes))));
}

function filterIntervalPacket(device, days) {
  return writePacket(device, P.FILTER_INTERVAL, Math.max(70, Math.min(365, Math.round(days))));
}

function durationPacket(device, number, minutes, hours) {
  return writePacket(device, number, [
    Math.max(0, Math.min(59, Math.round(minutes))),
    Math.max(0, Math.min(23, Math.round(hours))),
  ]);
}

function nightDurationPacket(device, minutes, hours) {
  return durationPacket(device, P.NIGHT_DURATION, minutes, hours);
}

function partyDurationPacket(device, minutes, hours) {
  return durationPacket(device, P.PARTY_DURATION, minutes, hours);
}

function stageSpeedPacket(device, number, value) {
  return writePacket(device, number, Math.max(10, Math.min(255, Math.round(value))));
}

// A schedule entry selects the weekday and period when reading, and carries
// all six bytes when writing.
function scheduleEntryReadPacket(device, weekday, period) {
  return readPacket(device, [
    { number: P.SCHEDULE_ENTRY, value: [weekday, period] },
  ]);
}

function validateScheduleEntry(entry) {
  const weekday = Number(entry.weekday);
  const period = Number(entry.period);
  const speed = Number(entry.speed);
  const minutes = Number(entry.minutes);
  let hours = Number(entry.hours);
  let reserved = entry.reserved === undefined ? 0 : Number(entry.reserved);

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 9) {
    throw new Error(`Invalid schedule weekday: ${entry.weekday}`);
  }
  if (!Number.isInteger(period) || period < 1 || period > 4) {
    throw new Error(`Invalid schedule period: ${entry.period}`);
  }
  if (!Number.isInteger(speed) || speed < 0 || speed > 3) {
    throw new Error(`Invalid schedule speed: ${entry.speed}`);
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid schedule minutes: ${entry.minutes}`);
  }
  if (!Number.isInteger(hours) || hours < 0 || hours > 24) {
    throw new Error(`Invalid schedule hours: ${entry.hours}`);
  }
  if (hours === 24 && minutes !== 0) {
    throw new Error('A period ending at 24:00 must have zero minutes');
  }
  // The unit stores the end of the last period as 00:00.
  if (hours === 24) hours = 0;
  if (!Number.isInteger(reserved) || reserved < 0 || reserved > 255) reserved = 0;

  return { weekday, period, speed, reserved, minutes, hours };
}

function scheduleEntryWritePacket(device, entry) {
  const value = validateScheduleEntry(entry);
  return writePacket(device, P.SCHEDULE_ENTRY, [
    value.weekday,
    value.period,
    value.speed,
    value.reserved,
    value.minutes,
    value.hours,
  ]);
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

  const family = options.family === 'smart' ? 'smart' : 's6w';
  const sizes = family === 'smart' ? SMART_PARAM_SIZES : PARAM_SIZES;
  let pos = header.dataOffset;
  let page = 0;

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
    silentEndSeconds: null,
    boost: null,
    boostActive: null,
    boostTimer: null,
    boostFlag: null,
    mode24h: null,
    interval: null,
    maxSpeed: null,
    silentSpeed: null,
    humidityMode: null,
    humiditySensor: null,
    relaySensor: null,
    analogSensor: null,
    humidityThreshold: null,
    analogLevel: null,
    relayActive: null,
    batteryStatus: null,
    humidityRunning: null,
    temperatureRunning: null,
    motionRunning: null,
    switchRunning: null,
    intervalRunning: null,
    silentRunning: null,
    temperatureMode: null,
    motionMode: null,
    switchMode: null,
    humiditySetpoint: null,
    temperatureSetpoint: null,
    intervalPercentage: null,
    silentActive: null,
    silentStartSeconds: null,
    clockSeconds: null,
    supplySpeed1: null,
    exhaustSpeed1: null,
    supplySpeed2: null,
    exhaustSpeed2: null,
    supplySpeed3: null,
    exhaustSpeed3: null,
    filterInterval: null,
    boostDelay: null,
    rtcBattery: null,
    rtcTime: null,
    rtcDate: null,
    schedule: null,
    scheduleEntry: null,
    scheduleEntries: [],
    machineHours: null,
    alarm: null,
    analogThreshold: null,
    turnOffDelay: null,
    turnOnDelay: null,
    timerMode: null,
    timerSeconds: null,
    nightMinutes: null,
    nightHours: null,
    partyMinutes: null,
    partyHours: null,
    humidityOver: null,
    analogOver: null,
    missing: [],
  };

  const uint16 = (start) => buffer[start] + (buffer[start + 1] << 8);

  try {
    // A parameter needs at least a lead byte and one value byte, and the
    // packet always ends with a two byte checksum.
    while (pos + 4 <= buffer.length) {
      let parameter = readByte();

      if (parameter === MARKER.PAGE) {
        page = readByte();
        continue;
      }
      if (parameter === MARKER.NOT_SUPPORTED) {
        result.missing.push((page << 8) | readByte());
        continue;
      }
      if (parameter === MARKER.FUNCTION) {
        readByte();
        continue;
      }

      let size;
      if (parameter === MARKER.SIZE) {
        size = readByte();
        parameter = (page << 8) | readByte();
      } else {
        parameter = (page << 8) | parameter;
        size = sizes[parameter] !== undefined ? sizes[parameter] : 1;
      }

      if (pos + size > buffer.length - 2) break;
      const start = pos;
      const number = parameter;

      switch (number) {
        case P.POWER:
          result.isOn = buffer[start] !== 0;
          break;
        case P.SPEED:
          if (family === 'smart') result.batteryStatus = buffer[start];
          else result.speed = buffer[start];
          break;
        case P.BOOST_STATUS:
          if (family === 'smart') result.boostTimer = buffer[start] + (buffer[start + 1] << 8) + (buffer[start + 2] << 16);
          else result.boostActive = buffer[start] !== 0;
          break;
        case P.TIMER_MODE:
          if (family === 'smart') result.boostFlag = buffer[start] !== 0;
          else result.timerMode = buffer[start];
          break;
        case P.TIMER_COUNTDOWN:
          if (family === 'smart') result.motionRunning = buffer[start] !== 0;
          else {
            result.timerSeconds =
              buffer[start] + buffer[start + 1] * 60 + buffer[start + 2] * 3600;
          }
          break;
        case P.HUMIDITY_SENSOR:
          if (family === 'smart') result.humidityMode = buffer[start];
          else result.humiditySensor = buffer[start];
          break;
        case P.RELAY_SENSOR:
          if (family === 'smart') result.humiditySetpoint = buffer[start];
          else result.relaySensor = buffer[start];
          break;
        case P.ANALOG_SENSOR:
          if (family === 'smart') result.temperatureSetpoint = buffer[start];
          else result.analogSensor = buffer[start];
          break;
        case P.HUMIDITY_THRESHOLD:
          result.humidityThreshold = buffer[start];
          break;
        case P.RTC_BATTERY:
          if (family === 'smart') result.turnOnDelay = buffer[start];
          else result.rtcBattery = uint16(start);
          break;
        case P.HUMIDITY:
          result.humidity = buffer[start];
          break;
        case P.ANALOG_LEVEL:
          result.analogLevel = buffer[start];
          break;
        case P.RELAY_ACTIVE:
          result.relayActive = buffer[start] !== 0;
          break;
        case P.SUPPLY_SPEED_1:
          result.supplySpeed1 = buffer[start];
          break;
        case P.EXHAUST_SPEED_1:
          result.exhaustSpeed1 = buffer[start];
          break;
        case P.SUPPLY_SPEED_2:
          result.supplySpeed2 = buffer[start];
          break;
        case P.EXHAUST_SPEED_2:
          result.exhaustSpeed2 = buffer[start];
          break;
        case P.SUPPLY_SPEED_3:
          result.supplySpeed3 = buffer[start];
          break;
        case P.EXHAUST_SPEED_3:
          result.exhaustSpeed3 = buffer[start];
          break;
        case P.MANUAL_SPEED:
          result.manualSpeed = buffer[start];
          break;
        case P.FAN_RPM:
          result.fanRpm = uint16(start);
          break;
        case PARAM.FAN_RPM:
          result.rpm = uint16(start);
          break;
        case P.FILTER_INTERVAL:
          result.filterInterval = uint16(start);
          break;
        case P.FILTER_TIMER:
          result.filterTimer =
            buffer[start] + (buffer[start + 2] * 24 + buffer[start + 1]) * 60;
          break;
        case P.BOOST_DELAY:
          result.boostDelay = buffer[start];
          break;
        case P.RTC_TIME:
          result.rtcTime = {
            seconds: buffer[start],
            minutes: buffer[start + 1],
            hours: buffer[start + 2],
          };
          break;
        case P.RTC_DATE:
          result.rtcDate = {
            day: buffer[start],
            weekday: buffer[start + 1],
            month: buffer[start + 2],
            year: buffer[start + 3],
          };
          break;
        case P.SCHEDULE:
          result.schedule = buffer[start] !== 0;
          break;
        case P.SCHEDULE_ENTRY:
          result.scheduleEntry = {
            weekday: buffer[start],
            period: buffer[start + 1],
            speed: buffer[start + 2],
            reserved: buffer[start + 3],
            minutes: buffer[start + 4],
            hours: buffer[start + 5],
          };
          result.scheduleEntries.push(result.scheduleEntry);
          break;
        case P.SEARCH:
          result.searchDeviceId = cleanString(buffer.toString('ascii', start, start + 16));
          break;
        case P.MACHINE_HOURS:
          result.machineHours = {
            minutes: buffer[start],
            hours: buffer[start + 1],
            days: uint16(start + 2),
          };
          break;
        case P.ALARM:
          result.alarm = buffer[start];
          break;
        case P.FIRMWARE:
          result.firmwareVersion = `${buffer[start]}.${buffer[start + 1]}`;
          result.firmwareDate =
            `${buffer[start + 2]}-${buffer[start + 3]}-` +
            `${buffer[start + 4] + (buffer[start + 5] << 8)}`;
          break;
        case P.UNIT_TYPE:
          result.unitType = buffer[start];
          break;
        case P.FILTER_REPLACE:
          result.filterAlarm = buffer[start] !== 0;
          break;
        case P.MODE:
          result.mode = buffer[start];
          break;
        case P.ANALOG_THRESHOLD:
          result.analogThreshold = buffer[start];
          break;
        case P.NIGHT_DURATION:
          result.nightMinutes = buffer[start];
          result.nightHours = buffer[start + 1];
          break;
        case P.PARTY_DURATION:
          result.partyMinutes = buffer[start];
          result.partyHours = buffer[start + 1];
          break;
        case P.HUMIDITY_OVER:
          result.humidityOver = buffer[start] !== 0;
          break;
        case P.ANALOG_OVER:
          result.analogOver = buffer[start] !== 0;
          break;
        case PARAM.MODE_24H:
          result.mode24h = buffer[start] !== 0;
          break;
        case PARAM.INTERVAL:
          result.interval = buffer[start] !== 0;
          break;
        case PARAM.BOOST:
          result.boost = buffer[start] !== 0;
          break;
        case PARAM.HUMIDITY_RUNNING:
          result.humidityRunning = buffer[start] !== 0;
          break;
        case PARAM.TEMPERATURE_RUNNING:
          result.temperatureRunning = buffer[start] !== 0;
          break;
        case PARAM.MOTION_RUNNING:
          result.motionRunning = buffer[start] !== 0;
          break;
        case PARAM.SWITCH_RUNNING:
          result.switchRunning = buffer[start] !== 0;
          break;
        case PARAM.INTERVAL_RUNNING:
          result.intervalRunning = buffer[start] !== 0;
          break;
        case PARAM.SILENT_RUNNING:
          result.silentRunning = buffer[start] !== 0;
          break;
        case PARAM.TEMPERATURE_MODE:
          result.temperatureMode = buffer[start];
          break;
        case PARAM.MOTION_MODE:
          result.motionMode = buffer[start];
          break;
        case PARAM.SWITCH_MODE:
          result.switchMode = buffer[start];
          break;
        case PARAM.INTERVAL_PERCENTAGE:
          result.intervalPercentage = buffer[start];
          break;
        case PARAM.SILENT_ACTIVE:
          result.silentActive = buffer[start] !== 0;
          break;
        case PARAM.SILENT_START:
          result.silentStartSeconds =
            buffer[start] + (buffer[start + 1] << 8) + (buffer[start + 2] << 16);
          break;
        case PARAM.CLOCK:
          result.clockSeconds =
            buffer[start] + (buffer[start + 1] << 8) + (buffer[start + 2] << 16);
          break;
        case PARAM.MAX_SPEED:
          result.maxSpeed = buffer[start];
          break;
        case PARAM.SILENT_SPEED:
          result.silentSpeed = buffer[start];
          break;
        case PARAM.TURN_OFF_DELAY:
          result.turnOffDelay = buffer[start];
          break;
        case PARAM.SMART_HUMIDITY:
          result.humidity = buffer[start];
          break;
        case PARAM.SMART_TEMPERATURE:
          result.temperature = buffer[start];
          break;
        case PARAM.SILENT_END:
          // On the smart fan 0x20 is the end of the silent window in seconds,
          // not a temperature. The live fan reports 20700 here (05:45) while
          // 0x31 reports 14 C.
          result.silentEndSeconds =
            buffer[start] + (buffer[start + 1] << 8) + (buffer[start + 2] << 16);
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
  MARKER,
  PARAM,
  P,
  SPEED,
  MODE,
  TIMER_MODE,
  PARAM_SIZES,
  SMART_PARAM_SIZES,
  S6W_PARAM_SIZES,
  S6W_STATUS_PARAMS,
  checksum,
  readHeader,
  buildPacket,
  parameterBytes,
  readPacket,
  writePacket,
  searchPacket,
  statusPacket,
  s6wStatusPacket,
  smartStatusPacket,
  smartSettingPacket,
  firmwarePacket,
  onOffPacket,
  speedPacket,
  manualSpeedPacket,
  modePacket,
  resetFilterPacket,
  timerModePacket,
  schedulePacket,
  sensorPacket,
  humidityThresholdPacket,
  analogThresholdPacket,
  boostDelayPacket,
  filterIntervalPacket,
  nightDurationPacket,
  partyDurationPacket,
  stageSpeedPacket,
  scheduleEntryReadPacket,
  scheduleEntryWritePacket,
  validateScheduleEntry,
  parseResponse,
};
