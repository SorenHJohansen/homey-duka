'use strict';

const dgram = require('node:dgram');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const protocol = require('./duka-protocol');
const { familyForUnitType } = require('./duka-family');
const {
  roundToStep,
  changedByAtLeast,
  TEMPERATURE_STEP,
  RPM_STEP,
  HUMIDITY_STEP,
} = require('./duka-values');

const PORT = 4000;
const BROADCAST = '255.255.255.255';

function normalizeId(value) {
  return String(value || '').trim().toUpperCase();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ipv4ToInt(address) {
  return address.split('.').reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

function subnetBroadcast(address, netmask) {
  if (!address || !netmask) return null;
  const broadcast = (ipv4ToInt(address) | (~ipv4ToInt(netmask) >>> 0)) >>> 0;
  return intToIpv4(broadcast);
}

function broadcastAddresses() {
  const addresses = new Set([BROADCAST]);
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const broadcast = subnetBroadcast(entry.address, entry.netmask);
      if (broadcast) addresses.add(broadcast);
    }
  }
  return [...addresses];
}

/**
 * Minimal state for a DUKA unit as it is learned from UDP responses.
 */
function createDeviceState({ id, password, address, family }) {
  return {
    id,
    password: String(password || '1111'),
    address: address || null,
    family: family || null,
    temporary: false,
    createdAt: Date.now(),
    lastSeen: 0,
    lastPollAt: 0,
    refreshTimer: null,
    firmwareRequestedAt: 0,
    firmwareAttempts: 0,
    isOn: null,
    speed: null,
    manualSpeed: null,
    mode: null,
    humidity: null,
    filterAlarm: null,
    filterTimer: null,
    fanRpm: null,
    firmwareVersion: null,
    firmwareDate: null,
    unitType: null,
    rpm: null,
    temperature: null,
    boost: null,
    boostActive: null,
    boostTimer: null,
    boostFlag: null,
    mode24h: null,
    interval: null,
    maxSpeed: null,
    silentSpeed: null,
    humidityMode: null,
    humidityThreshold: null,
    boostMinutes: null,
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
    silentEndSeconds: null,
    clockSeconds: null,
    turnOffDelay: null,
    turnOnDelay: null,
    // S6W settings and sensor states.
    timerMode: null,
    timerSeconds: null,
    timerMinutes: null,
    humiditySensor: null,
    relaySensor: null,
    analogSensor: null,
    analogThreshold: null,
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
    machineHours: null,
    alarm: null,
    nightMinutes: null,
    nightHours: null,
    partyMinutes: null,
    partyHours: null,
    humidityOver: null,
    analogOver: null,
    missing: [],
  };
}

class DukaClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.log = options.log || (() => {});
    this.error = options.error || (() => {});
    this.devices = new Map();
    this.searchResults = new Map();
    this.socket = null;
    this.port = null;
    this._starting = null;
    this._delay = options.delay || delay;
    this._createSocket =
      options.createSocket || (() => dgram.createSocket({ type: 'udp4', reuseAddr: true }));
    this._broadcastAddresses = options.broadcastAddresses || broadcastAddresses;
    this._setTimeout = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = options.clearTimeout || ((timer) => clearTimeout(timer));
    this._timers = new Set();
  }

  _timeout(fn, ms) {
    const timer = this._setTimeout(() => {
      this._timers.delete(timer);
      fn();
    }, ms);
    this._timers.add(timer);
    return timer;
  }

  _clearTimer(timer) {
    if (!timer) return;
    this._timers.delete(timer);
    this._clearTimeout(timer);
  }

  _clearTimers() {
    for (const timer of this._timers) this._clearTimeout(timer);
    this._timers.clear();
  }

  async start() {
    if (this.socket) return;
    if (!this._starting) {
      this._starting = this._open()
        .catch((err) => {
          this.error('Could not open the DUKA socket:', err.message);
          throw err;
        })
        .finally(() => {
          this._starting = null;
        });
    }
    await this._starting;
  }

  async _open() {
    let bound;
    try {
      bound = await this._bind(PORT);
    } catch (err) {
      this.log(`Port ${PORT} is unavailable (${err.code || err.message}), using a random port`);
      bound = await this._bind(0);
    }

    this.socket = bound.socket;
    this.port = bound.port;
    this.log(`DUKA socket listening on UDP port ${this.port}`);
  }

  _bind(port) {
    return new Promise((resolve, reject) => {
      const socket = this._createSocket();
      const onError = (err) => {
        socket.removeListener('listening', onListening);
        socket.close();
        reject(err);
      };
      const onListening = () => {
        socket.removeListener('error', onError);
        socket.setBroadcast(true);
        socket.on('error', (err) => {
          this.error('DUKA socket error:', err.message);
          this._close();
        });
        socket.on('message', (message, rinfo) => this._onMessage(message, rinfo));
        resolve({ socket, port: socket.address().port });
      };
      socket.once('error', onError);
      socket.once('listening', onListening);
      socket.bind(port, '0.0.0.0');
    });
  }

  _close() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch (err) {
      // Closing an already closed socket is harmless.
    }
    this.socket = null;
    this.port = null;
  }

  async stop() {
    this._clearTimers();
    this._close();
    this.devices.clear();
    this.searchResults.clear();
  }

  _ensureDevice({ id, password, address, family }) {
    const deviceId = normalizeId(id);
    let device = this.devices.get(deviceId);
    if (!device) {
      device = createDeviceState({ id: deviceId, password, address, family });
      this.devices.set(deviceId, device);
    } else {
      if (password) device.password = String(password);
      if (address) device.address = address;
      if (family) device.family = family;
      device.temporary = false;
    }
    return device;
  }

  registerDevice({ id, password, address, family }) {
    const device = this._ensureDevice({ id, password, address, family });
    if (!device.address) this.discover().catch(() => {});
    else this.requestStatus(device).catch(() => {});
    return device;
  }

  removeDevice(id) {
    const deviceId = normalizeId(id);
    const device = this.devices.get(deviceId);
    if (device && device.refreshTimer) this._clearTimer(device.refreshTimer);
    return this.devices.delete(deviceId);
  }

  getDevice(id) {
    return this.devices.get(normalizeId(id)) || null;
  }

  _onMessage(message, rinfo) {
    const header = protocol.readHeader(message);
    if (!header) return;

    const packetId = normalizeId(header.deviceId);
    const known = this.devices.get(packetId);
    const packet = protocol.parseResponse(message, { family: known ? known.family : null });
    if (!packet) return;

    const searchId = normalizeId(packet.searchDeviceId);
    if (searchId) {
      const current = this.searchResults.get(searchId) || {};
      this.searchResults.set(searchId, {
        address: rinfo.address,
        unitType: packet.unitType !== null ? packet.unitType : current.unitType ?? null,
      });
    }

    const device = known || (searchId ? this.devices.get(searchId) : null);
    if (!device) return;

    if (rinfo.address && rinfo.address !== device.address) {
      device.address = rinfo.address;
      this.emit('address', device);
    }

    const changed = this._applyPacket(device, packet);
    for (const entry of packet.scheduleEntries) this.emit('schedule', entry, device.id);
    if (changed) this.emit('update', device);
  }

  _applyPacket(device, packet) {
    let changed = false;

    if (!device.family && packet.unitType !== null) {
      device.family = familyForUnitType(packet.unitType);
    }

    const set = (key, value) => {
      if (value === null || value === undefined) return;
      if (device[key] === value) return;
      device[key] = value;
      changed = true;
    };

    set('isOn', packet.isOn);
    // Relative humidity jitters a point or two between polls, so it is only
    // published when it has moved at least 5 points.
    if (changedByAtLeast(device.humidity, packet.humidity, HUMIDITY_STEP)) {
      set('humidity', packet.humidity);
    }

    if (device.family === 'smart') {
      if (packet.rpm !== null && changedByAtLeast(device.rpm, packet.rpm, RPM_STEP, true)) {
        set('rpm', packet.rpm);
      }
      if (packet.temperature !== null) {
        const temperature = roundToStep(packet.temperature, TEMPERATURE_STEP);
        if (changedByAtLeast(device.temperature, temperature, TEMPERATURE_STEP / 2)) {
          set('temperature', temperature);
        }
      }
      set('boost', packet.boost);
      set('mode24h', packet.mode24h);
      set('interval', packet.interval);
      set('maxSpeed', packet.maxSpeed);
      set('silentSpeed', packet.silentSpeed);
      set('humidityMode', packet.humidityMode);
      set('humiditySetpoint', packet.humiditySetpoint);
      set('temperatureMode', packet.temperatureMode);
      set('temperatureSetpoint', packet.temperatureSetpoint);
      set('motionMode', packet.motionMode);
      set('switchMode', packet.switchMode);
      set('intervalPercentage', packet.intervalPercentage);
      set('silentActive', packet.silentActive);
      set('silentStartSeconds', packet.silentStartSeconds);
      set('silentEndSeconds', packet.silentEndSeconds);
      set('clockSeconds', packet.clockSeconds);
      set('turnOffDelay', packet.turnOffDelay);
      set('turnOnDelay', packet.turnOnDelay);
      set('batteryStatus', packet.batteryStatus);
      set('humidityRunning', packet.humidityRunning);
      set('temperatureRunning', packet.temperatureRunning);
      set('motionRunning', packet.motionRunning);
      set('switchRunning', packet.switchRunning);
      set('intervalRunning', packet.intervalRunning);
      set('silentRunning', packet.silentRunning);

      // The boost countdown changes every second. Only whole minutes are a
      // state change.
      if (packet.boostTimer !== null) {
        device.boostTimer = packet.boostTimer;
        const minutes = Math.ceil(packet.boostTimer / 60);
        if (device.boostMinutes !== minutes) {
          device.boostMinutes = minutes;
          changed = true;
        }
      }
    } else {
      set('speed', packet.speed);
      set('manualSpeed', packet.manualSpeed);
      set('mode', packet.mode);
      set('filterAlarm', packet.filterAlarm);
      set('filterTimer', packet.filterTimer);
      set('boostActive', packet.boostActive);
      set('timerMode', packet.timerMode);
      set('humiditySensor', packet.humiditySensor);
      set('relaySensor', packet.relaySensor);
      set('analogSensor', packet.analogSensor);
      set('humidityThreshold', packet.humidityThreshold);
      set('analogThreshold', packet.analogThreshold);
      set('analogLevel', packet.analogLevel);
      set('relayActive', packet.relayActive);
      set('supplySpeed1', packet.supplySpeed1);
      set('exhaustSpeed1', packet.exhaustSpeed1);
      set('supplySpeed2', packet.supplySpeed2);
      set('exhaustSpeed2', packet.exhaustSpeed2);
      set('supplySpeed3', packet.supplySpeed3);
      set('exhaustSpeed3', packet.exhaustSpeed3);
      set('filterInterval', packet.filterInterval);
      set('boostDelay', packet.boostDelay);
      set('rtcBattery', packet.rtcBattery);
      set('schedule', packet.schedule);
      set('alarm', packet.alarm);
      set('nightMinutes', packet.nightMinutes);
      set('nightHours', packet.nightHours);
      set('partyMinutes', packet.partyMinutes);
      set('partyHours', packet.partyHours);
      set('humidityOver', packet.humidityOver);
      set('analogOver', packet.analogOver);

      // The countdown changes every second, so only whole minutes are
      // published as a state change.
      if (packet.timerSeconds !== null) {
        device.timerSeconds = packet.timerSeconds;
        const minutes = Math.ceil(packet.timerSeconds / 60);
        if (device.timerMinutes !== minutes) {
          device.timerMinutes = minutes;
          changed = true;
        }
      }

      if (packet.machineHours !== null) {
        const next = packet.machineHours;
        const current = device.machineHours;
        if (
          !current ||
          current.minutes !== next.minutes ||
          current.hours !== next.hours ||
          current.days !== next.days
        ) {
          device.machineHours = next;
          changed = true;
        }
      }
    }

    device.missing = packet.missing;

    // Metadata and the constantly changing S6W fan rpm are stored silently.
    if (packet.fanRpm !== null) device.fanRpm = packet.fanRpm;
    if (packet.firmwareVersion !== null) device.firmwareVersion = packet.firmwareVersion;
    if (packet.firmwareDate !== null) device.firmwareDate = packet.firmwareDate;
    if (packet.unitType !== null) device.unitType = packet.unitType;

    if (device.family !== 'smart' && packet.isOn === false && device.speed !== protocol.SPEED.OFF) {
      device.speed = protocol.SPEED.OFF;
      changed = true;
    }

    device.lastSeen = Date.now();
    return changed;
  }

  async _sendTo(address, packet) {
    await this.start();
    if (!this.socket) throw new Error('The DUKA socket is not open');
    await new Promise((resolve, reject) => {
      this.socket.send(packet, 0, packet.length, PORT, address, (err) => {
        if (err) {
          this.error(`Could not send to ${address}:`, err.message);
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * The search packet contains no device id or password, so it is safe to
   * broadcast. Responses are used to learn the unit's address.
   */
  async discover() {
    const packet = protocol.searchPacket();
    for (const address of this._broadcastAddresses()) {
      await this._sendTo(address, packet).catch(() => {});
    }
  }

  async _send(device, packet) {
    if (!device.address) {
      await this.discover();
      await this._delay(600);
      if (!device.address) throw new Error('The DUKA unit address is not known yet');
    }
    return this._sendTo(device.address, packet);
  }

  async requestStatus(device, address = null) {
    const target = address || device.address;
    if (!target) {
      await this.discover();
      return;
    }
    const packet =
      device.family === 'smart'
        ? protocol.smartStatusPacket(device)
        : protocol.s6wStatusPacket(device);
    return this._sendTo(target, packet);
  }

  async requestFirmware(device, address = null) {
    const target = address || device.address;
    if (!target) {
      await this.discover();
      return;
    }
    return this._sendTo(target, protocol.firmwarePacket(device));
  }

  _scheduleRefresh(device, ms = 500) {
    if (device.refreshTimer) this._clearTimer(device.refreshTimer);
    device.refreshTimer = this._timeout(() => {
      device.refreshTimer = null;
      this.requestStatus(device).catch(() => {});
    }, ms);
  }

  async turnOn(device) {
    await this._send(device, protocol.onOffPacket(device, true));
    this._scheduleRefresh(device);
  }

  async turnOff(device) {
    await this._send(device, protocol.onOffPacket(device, false));
    this._scheduleRefresh(device);
  }

  async setSpeed(device, speed) {
    if (speed === protocol.SPEED.OFF) {
      await this.turnOff(device);
      return;
    }
    if (device.speed === protocol.SPEED.OFF || device.isOn === false) {
      await this.turnOn(device);
      await this._delay(400);
    }
    await this._send(device, protocol.speedPacket(device, speed));
    this._scheduleRefresh(device);
  }

  async setManualSpeed(device, value) {
    if (device.speed !== protocol.SPEED.MANUAL) {
      await this.setSpeed(device, protocol.SPEED.MANUAL);
      await this._delay(400);
    }
    await this._send(device, protocol.manualSpeedPacket(device, value));
    this._scheduleRefresh(device);
  }

  async setMode(device, mode) {
    await this._send(device, protocol.modePacket(device, mode));
    this._scheduleRefresh(device);
  }

  async setTimerMode(device, mode) {
    await this._send(device, protocol.timerModePacket(device, mode));
    this._scheduleRefresh(device);
  }

  async setSchedule(device, on) {
    await this._send(device, protocol.schedulePacket(device, on));
    this._scheduleRefresh(device);
  }

  async setHumiditySensor(device, on) {
    await this._send(device, protocol.sensorPacket(device, protocol.P.HUMIDITY_SENSOR, on));
    this._scheduleRefresh(device);
  }

  async setRelaySensor(device, on) {
    await this._send(device, protocol.sensorPacket(device, protocol.P.RELAY_SENSOR, on));
    this._scheduleRefresh(device);
  }

  async setAnalogSensor(device, on) {
    await this._send(device, protocol.sensorPacket(device, protocol.P.ANALOG_SENSOR, on));
    this._scheduleRefresh(device);
  }

  async setHumidityThreshold(device, percent) {
    await this._send(device, protocol.humidityThresholdPacket(device, percent));
    this._scheduleRefresh(device);
  }

  async setAnalogThreshold(device, percent) {
    await this._send(device, protocol.analogThresholdPacket(device, percent));
    this._scheduleRefresh(device);
  }

  async setBoostDelay(device, minutes) {
    await this._send(device, protocol.boostDelayPacket(device, minutes));
    this._scheduleRefresh(device);
  }

  async setFilterInterval(device, days) {
    await this._send(device, protocol.filterIntervalPacket(device, days));
    this._scheduleRefresh(device);
  }

  async setNightDuration(device, minutes, hours) {
    await this._send(device, protocol.nightDurationPacket(device, minutes, hours));
    this._scheduleRefresh(device);
  }

  async setPartyDuration(device, minutes, hours) {
    await this._send(device, protocol.partyDurationPacket(device, minutes, hours));
    this._scheduleRefresh(device);
  }

  async setStageSpeed(device, number, value) {
    await this._send(device, protocol.stageSpeedPacket(device, number, value));
    this._scheduleRefresh(device);
  }

  async setScheduleEntry(device, entry) {
    await this._send(device, protocol.scheduleEntryWritePacket(device, entry));
    this._scheduleRefresh(device);
  }

  /**
   * Read every weekly schedule entry. The unit answers the entries of each
   * request in one packet, so the week is two packets.
   */
  readSchedule(device, timeoutMs = 6000) {
    const days = [1, 2, 3, 4, 5, 6, 7];
    const entriesInDay = 4;

    return new Promise((resolve, reject) => {
      const entries = new Map();
      const key = (entry) => `${entry.weekday}:${entry.period}`;

      const finish = () => {
        this._clearTimer(timer);
        this.removeListener('schedule', onEntry);
        resolve(
          [...entries.values()].sort(
            (a, b) => a.weekday - b.weekday || a.period - b.period,
          ),
        );
      };

      const onEntry = (entry, id) => {
        if (id !== device.id) return;
        entries.set(key(entry), entry);
        if (entries.size >= days.length * entriesInDay) finish();
      };

      const timer = this._timeout(() => {
        if (entries.size) {
          finish();
          return;
        }
        this.removeListener('schedule', onEntry);
        reject(new Error('No answer from the DUKA unit'));
      }, timeoutMs);

      this.on('schedule', onEntry);

      // The unit drops a second schedule request that arrives back to back,
      // so one day is asked for per packet with a short pause in between.
      (async () => {
        for (const weekday of days) {
          const list = [1, 2, 3, 4].map((period) => ({
            number: protocol.P.SCHEDULE_ENTRY,
            value: [weekday, period],
          }));
          await this._send(device, protocol.readPacket(device, list));
          await this._delay(250);
        }
      })().catch((err) => {
        this._clearTimer(timer);
        this.removeListener('schedule', onEntry);
        reject(err);
      });
    });
  }

  /**
   * Read one weekly schedule entry. The unit answers with all six bytes of
   * the day and period that was asked for.
   */
  readScheduleEntry(device, weekday, period, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const onEntry = (entry, id) => {
        if (id !== device.id) return;
        if (entry.weekday !== weekday || entry.period !== period) return;
        this._clearTimer(timer);
        this.removeListener('schedule', onEntry);
        resolve(entry);
      };
      const timer = this._timeout(() => {
        this.removeListener('schedule', onEntry);
        reject(new Error('No answer from the DUKA unit'));
      }, timeoutMs);

      this.on('schedule', onEntry);
      this._send(device, protocol.scheduleEntryReadPacket(device, weekday, period)).catch(
        (err) => {
          this._clearTimer(timer);
          this.removeListener('schedule', onEntry);
          reject(err);
        },
      );
    });
  }

  async resetFilter(device) {
    await this._send(device, protocol.resetFilterPacket(device));
    this._scheduleRefresh(device);
  }

  async setBoost(device, on) {
    await this._send(device, protocol.smartSettingPacket(device, protocol.PARAM.BOOST, on ? 1 : 0));
    this._scheduleRefresh(device);
  }

  async set24h(device, on) {
    await this._send(
      device,
      protocol.smartSettingPacket(device, protocol.PARAM.MODE_24H, on ? 1 : 0),
    );
    this._scheduleRefresh(device);
  }

  async setIntervalVentilation(device, on) {
    await this._send(
      device,
      protocol.smartSettingPacket(device, protocol.PARAM.INTERVAL, on ? 1 : 0),
    );
    this._scheduleRefresh(device);
  }

  async setSilentSpeed(device, value) {
    const speed = Math.max(0, Math.min(100, Math.round(value)));
    await this._send(
      device,
      protocol.smartSettingPacket(device, protocol.PARAM.SILENT_SPEED, speed),
    );
    this._scheduleRefresh(device);
  }

  async setMaxSpeed(device, value) {
    const speed = Math.max(0, Math.min(100, Math.round(value)));
    await this._send(device, protocol.smartSettingPacket(device, protocol.PARAM.MAX_SPEED, speed));
    this._scheduleRefresh(device);
  }

  async _writeSmart(device, number, value) {
    await this._send(device, protocol.writePacket(device, number, value, 'smart'));
    this._scheduleRefresh(device);
  }

  async setHumidityMode(device, mode) {
    await this._writeSmart(device, protocol.PARAM.HUMIDITY_MODE, Math.max(0, Math.min(2, mode)));
  }

  async setHumiditySetpoint(device, percent) {
    const value = Math.max(30, Math.min(100, Math.round(percent)));
    await this._writeSmart(device, protocol.PARAM.HUMIDITY_SETPOINT, value);
  }

  async setTemperatureMode(device, mode) {
    await this._writeSmart(device, protocol.PARAM.TEMPERATURE_MODE, Math.max(0, Math.min(2, mode)));
  }

  async setTemperatureSetpoint(device, degrees) {
    const value = Math.max(18, Math.min(36, Math.round(degrees)));
    await this._writeSmart(device, protocol.PARAM.TEMPERATURE_SETPOINT, value);
  }

  async setSwitchMode(device, mode) {
    await this._writeSmart(device, protocol.PARAM.SWITCH_MODE, Math.max(0, Math.min(2, mode)));
  }

  async setIntervalPercentage(device, percent) {
    const value = Math.max(30, Math.min(100, Math.round(percent)));
    await this._writeSmart(device, protocol.PARAM.INTERVAL_PERCENTAGE, value);
  }

  async setSilentActive(device, on) {
    await this._writeSmart(device, protocol.PARAM.SILENT_ACTIVE, on ? 1 : 0);
  }

  async setSilentWindow(device, startSeconds, endSeconds) {
    await this._writeSmart(device, protocol.PARAM.SILENT_START, Math.max(0, startSeconds));
    await this._delay(200);
    await this._writeSmart(device, protocol.PARAM.SILENT_END, Math.max(0, endSeconds));
  }

  async setTurnOffDelay(device, code) {
    await this._writeSmart(device, protocol.PARAM.TURN_OFF_DELAY, Math.max(0, Math.min(6, code)));
  }

  async setTurnOnDelay(device, code) {
    await this._writeSmart(device, protocol.PARAM.TURN_ON_DELAY, Math.max(0, Math.min(2, code)));
  }

  /**
   * Broadcast the search command and collect the device ids that respond.
   */
  async search(timeoutMs = 4000) {
    await this.start();
    this.searchResults.clear();

    const packet = protocol.searchPacket();
    const addresses = this._broadcastAddresses();
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      for (const address of addresses) {
        await this._sendTo(address, packet).catch(() => {});
      }
      await this._delay(900);
    }

    return [...this.searchResults.entries()].map(([id, info]) => ({
      id,
      address: info.address,
      unitType: info.unitType,
      family: familyForUnitType(info.unitType),
    }));
  }

  /**
   * Verify that a unit answers on the given id, password and optional
   * address. The firmware reply identifies the family, then only that
   * family's status packet is used. The unit is not left registered unless
   * it was registered before.
   */
  async probe({ id, password, address, family = null, timeoutMs = 8000 }) {
    await this.start();
    const deviceId = normalizeId(id);
    const existed = this.devices.has(deviceId);
    const device = this._ensureDevice({ id: deviceId, password, address });
    device.temporary = !existed;
    const started = Date.now();

    let firmwareAttempts = 0;

    try {
      while (Date.now() - started < timeoutMs) {
        if (!device.address) {
          await this.discover();
          await this._delay(500);
          continue;
        }

        if (device.unitType === null && firmwareAttempts < 2) {
          await this.requestFirmware(device).catch(() => {});
          firmwareAttempts += 1;
          await this._delay(500);
        }

        if (device.unitType !== null) {
          device.family = familyForUnitType(device.unitType);
          if (device.family === 'unsupported') return { ...device };
        } else if (family) {
          // The unit did not report a model. Use the driver the user selected.
          device.family = family;
        } else {
          await this._delay(300);
          continue;
        }

        await this.requestStatus(device).catch(() => {});
        await this._delay(700);

        if (device.isOn !== null) {
          return { ...device };
        }
      }
      throw new Error(
        'No answer from the DUKA unit. Check the device ID, the password and that Homey is on the same network.',
      );
    } finally {
      if (!existed) this.devices.delete(deviceId);
    }
  }
}

module.exports = { DukaClient, PORT, BROADCAST };
