'use strict';

const Homey = require('homey');

const { SPEED, MODE, P, validateScheduleEntry } = require('./duka-protocol');
const { summarizeSchedule } = require('./duka-schedule');
const { S6W_CAPABILITIES, SMART_CAPABILITIES } = require('./duka-capabilities');
const { stepsFromSettings } = require('./duka-values');

const MODE_BY_ID = {
  out: MODE.OUT,
  inout: MODE.INOUT,
  in: MODE.IN,
};

const MODE_ID = {
  [MODE.OUT]: 'out',
  [MODE.INOUT]: 'inout',
  [MODE.IN]: 'in',
};

const TIMER_MODE_BY_ID = {
  off: 0,
  night: 1,
  party: 2,
};

const TIMER_MODE_ID = {
  0: 'off',
  1: 'night',
  2: 'party',
};

// Settings that map straight onto a fan stage speed parameter.
const STAGE_SETTINGS = {
  supply_speed_1: P.SUPPLY_SPEED_1,
  exhaust_speed_1: P.EXHAUST_SPEED_1,
  supply_speed_2: P.SUPPLY_SPEED_2,
  exhaust_speed_2: P.EXHAUST_SPEED_2,
  supply_speed_3: P.SUPPLY_SPEED_3,
  exhaust_speed_3: P.EXHAUST_SPEED_3,
};

const HUMIDITY_MODE_IDS = { 0: 'off', 1: 'auto', 2: 'manual' };
const SETTING_MODE_IDS = { 0: 'off', 1: 'on', 2: 'invert' };
const HUMIDITY_MODE_BY_ID = { off: 0, auto: 1, manual: 2 };
const SETTING_MODE_BY_ID = { off: 0, on: 1, invert: 2 };
const OFF_DELAY_CODES = new Set(['0', '2', '3', '4', '6']);
const ON_DELAY_CODES = new Set(['0', '1', '2']);
const SETTINGS_HOLD_MS = 5000;

function clockText(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const hours = String(Math.floor(seconds / 3600) % 24).padStart(2, '0');
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function clockSeconds(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 3600 + minutes * 60;
}

// The unit reports four discrete speeds. These are the percentages shown in
// the Homey UI, mirroring the Home Assistant integration.
const SPEED_DIM = {
  [SPEED.LOW]: 0.1,
  [SPEED.MEDIUM]: 0.35,
  [SPEED.HIGH]: 0.7,
};

const SPEED_BY_PRESET = {
  off: SPEED.OFF,
  low: SPEED.LOW,
  medium: SPEED.MEDIUM,
  high: SPEED.HIGH,
};

const OFFLINE_TIMEOUT = 60 * 1000;
const AVAILABILITY_INTERVAL = 20 * 1000;
const SCHEDULE_REFRESH = 60 * 60 * 1000;

class DukaDevice extends Homey.Device {
  async onInit() {
    this.deviceId = String(this.getData().id || '').trim().toUpperCase();
    this.client = this.homey.app.duka;
    this.family = this.getStoreValue('family') || 's6w';
    // Units that do not report a manual speed only have the three fixed
    // speeds, so the slider is mapped to those instead.
    this.supportsManualSpeed = this.getStoreValue('manualSpeed') !== false;
    this._queue = Promise.resolve();

    await this._migrateFanSpeed();
    await this._migrateFanRpmBack();
    await this._syncCapabilities();

    this.state = this.client.registerDevice({
      id: this.deviceId,
      password: this.getStoreValue('password') || '1111',
      address: this.getStoreValue('address') || null,
      family: this.family,
    });
    this.state.steps = stepsFromSettings(this.getSettings());

    this._available = true;
    this._initAt = Date.now();
    this._stateQueue = Promise.resolve();
    this._settingsHold = new Map();

    this._onUpdate = (device) => {
      if (device.id !== this.deviceId) return;
      if (device.family && device.family !== 'unsupported' && device.family !== this.family) {
        this.family = device.family;
        this.setStoreValue('family', device.family).catch(this.error);
        this._syncCapabilities().catch(this.error);
      }
      this._stateQueue = this._stateQueue
        .then(() => this._applyState(device))
        .catch(this.error);
    };
    this.client.on('update', this._onUpdate);

    this._onAddress = (device) => {
      if (device.id !== this.deviceId) return;
      this.setStoreValue('address', device.address).catch(this.error);
    };
    this.client.on('address', this._onAddress);

    this.registerCapabilityListener('onoff', async (value) => {
      await this._enqueue(() =>
        value ? this.client.turnOn(this.state) : this.client.turnOff(this.state),
      );
    });

    if (this.hasCapability('dim')) {
      this.registerMultipleCapabilityListener(
        ['dim'],
        async ({ dim }) => {
          await this.setManualPercent(dim * 100);
        },
        250,
      );
    }

    if (this.hasCapability('duka_fan_speed')) {
      this.registerMultipleCapabilityListener(
        ['duka_fan_speed'],
        async ({ duka_fan_speed }) => {
          await this.setManualPercent(Number(duka_fan_speed));
        },
        250,
      );
    }

    if (this.hasCapability('duka_humidity_setpoint')) {
      this.registerMultipleCapabilityListener(
        ['duka_humidity_setpoint'],
        async ({ duka_humidity_setpoint }) => {
          await this._enqueue(() =>
            this.client.setHumidityThreshold(this.state, Number(duka_humidity_setpoint)),
          );
        },
        250,
      );
    }

    if (this.hasCapability('duka_mode')) {
      this.registerCapabilityListener('duka_mode', async (value) => {
        await this.setMode(value);
      });
    }

    if (this.hasCapability('duka_timer_mode')) {
      this.registerCapabilityListener('duka_timer_mode', async (value) => {
        await this.setTimerMode(value);
      });
    }

    if (this.hasCapability('duka_schedule')) {
      this.registerCapabilityListener('duka_schedule', async (value) => {
        await this.setSchedule(value);
      });
    }

    if (this.hasCapability('button.reset_filter')) {
      this.registerCapabilityListener('button.reset_filter', async () => {
        await this.resetFilter();
      });
    }

    if (this.hasCapability('duka_boost')) {
      this.registerCapabilityListener('duka_boost', async (value) => {
        await this.setBoost(value);
      });
    }

    if (this.hasCapability('duka_24h')) {
      this.registerCapabilityListener('duka_24h', async (value) => {
        await this.set24h(value);
      });
    }

    if (this.hasCapability('duka_interval')) {
      this.registerCapabilityListener('duka_interval', async (value) => {
        await this.setIntervalVentilation(value);
      });
    }

    if (this.hasCapability('duka_silent_speed')) {
      this.registerMultipleCapabilityListener(
        ['duka_silent_speed'],
        async ({ duka_silent_speed }) => {
          await this.setSilentSpeed(duka_silent_speed);
        },
        250,
      );
    }

    if (this.hasCapability('duka_max_speed')) {
      this.registerMultipleCapabilityListener(
        ['duka_max_speed'],
        async ({ duka_max_speed }) => {
          await this.setMaxSpeed(duka_max_speed);
        },
        250,
      );
    }

    const setIntervalFn =
      typeof this.homey.setInterval === 'function'
        ? this.homey.setInterval.bind(this.homey)
        : setInterval;
    this.availabilityTimer = setIntervalFn(
      () => this._checkAvailability(),
      AVAILABILITY_INTERVAL,
    );

    await this._applyState(this.state);

    this._scheduleBusy = false;
    this._scheduleEntries = new Map();
    this._refreshSchedule().catch(this.error);
  }

  /**
   * The weekly schedule is not part of the status reply. It is read as 28
   * entries, one day per packet, at startup and then hourly.
   */
  async readScheduleEntries() {
    if (!this.hasCapability('duka_schedule_text')) {
      throw new Error('This DUKA unit has no weekly schedule');
    }

    const entries = await this.client.readSchedule(this.state);
    this._scheduleReadAt = Date.now();
    this._scheduleEntries = new Map(
      entries.map((entry) => [`${entry.weekday}:${entry.period}`, entry]),
    );
    await this._publishSchedule(entries);
    return entries;
  }

  async readScheduleQueued() {
    return this._enqueue(() => this.readScheduleEntries());
  }

  async _publishSchedule(entries) {
    const summary = entries.length ? summarizeSchedule(entries) : '';
    if (this.getCapabilityValue('duka_schedule_text') !== summary) {
      await this.setCapabilityValue('duka_schedule_text', summary).catch(this.error);
    }
  }

  async _refreshSchedule() {
    if (!this.hasCapability('duka_schedule_text')) return;
    if (!this.state.address) return;
    if (this._scheduleBusy) return;

    this._scheduleBusy = true;
    try {
      await this.readScheduleQueued();
    } catch (err) {
      this.log('Could not read the schedule:', err.message);
      // Do not hammer a silent unit; try again in ten minutes.
      this._scheduleReadAt = Date.now() - SCHEDULE_REFRESH + 10 * 60 * 1000;
    } finally {
      this._scheduleBusy = false;
    }
  }

  /**
   * Undo the measure_fan_rpm rename on devices that already installed it.
   * The value is copied back before the temporary capability is removed.
   */
  async _migrateFanRpmBack() {
    if (this.family !== 'smart' || !this.hasCapability('measure_fan_rpm')) return;

    const value = this.getCapabilityValue('measure_fan_rpm');
    if (!this.hasCapability('duka_fan_rpm')) {
      await this.addCapability('duka_fan_rpm').catch(this.error);
    }
    if (!this.hasCapability('duka_fan_rpm')) {
      this.error('Could not restore duka_fan_rpm, keeping measure_fan_rpm');
      return;
    }
    if (typeof value === 'number') {
      await this.setCapabilityValue('duka_fan_rpm', value).catch(this.error);
    }
    await this.removeCapability('measure_fan_rpm').catch(this.error);
  }

  async _syncCapabilities() {
    if (this.family !== 's6w' && this.family !== 'smart') return;

    const list = this.family === 'smart' ? SMART_CAPABILITIES : S6W_CAPABILITIES;
    const other = this.family === 'smart' ? S6W_CAPABILITIES : SMART_CAPABILITIES;
    const mine = new Set(list);

    for (const capability of list) {
      if (this.hasCapability(capability)) continue;
      await this.addCapability(capability).catch(this.error);
    }

    // A device whose family changed must not keep capabilities that belong
    // to the other family.
    for (const capability of other) {
      if (mine.has(capability)) continue;
      if (!this.hasCapability(capability)) continue;
      await this.removeCapability(capability).catch(this.error);
    }
  }

  async _migrateFanSpeed() {
    if (this.family !== 's6w') return;

    if (!this.hasCapability('duka_fan_speed')) {
      await this.addCapability('duka_fan_speed').catch(this.error);
    }
    if (!this.hasCapability('duka_fan_speed')) {
      this.error('Could not add duka_fan_speed, keeping dim');
      return;
    }
    if (this.hasCapability('dim')) {
      const dim = this.getCapabilityValue('dim');
      if (typeof dim === 'number') {
        await this.setCapabilityValue('duka_fan_speed', Math.round(dim * 100)).catch(this.error);
      }
      await this.removeCapability('dim').catch(this.error);
    }
  }

  async _applyState(state) {
    if (!this._available) {
      await this.setAvailable().catch(this.error);
      this._available = true;
    }

    const values = {};

    if (state.isOn !== null) values.onoff = state.isOn;
    if (state.humidity !== null) values.measure_humidity = state.humidity;

    if (this.family === 'smart') {
      if (state.rpm !== null) values.duka_fan_rpm = state.rpm;
      if (state.temperature !== null) values.measure_temperature = state.temperature;
      if (state.boost !== null) values.duka_boost = state.boost;
      if (state.mode24h !== null) values.duka_24h = state.mode24h;
      if (state.interval !== null) values.duka_interval = state.interval;
      if (state.silentSpeed !== null) values.duka_silent_speed = state.silentSpeed;
      if (state.maxSpeed !== null) values.duka_max_speed = state.maxSpeed;
      if (state.boostMinutes !== null) values.duka_boost_minutes = state.boostMinutes;
      if (state.silentRunning !== null) values.duka_silent_active = state.silentRunning;
      if (state.intervalRunning !== null) values.duka_interval_active = state.intervalRunning;
      if (state.motionRunning !== null) values.duka_motion_active = state.motionRunning;
      await this._syncMotionCapability();
    } else {
      let percent = null;
      if (state.speed !== null) {
        if (state.speed === SPEED.OFF) {
          percent = 0;
        } else if (state.speed === SPEED.MANUAL) {
          if (typeof state.manualSpeed === 'number') {
            percent = Math.round(
              Math.min(1, Math.max(0.01, state.manualSpeed / 255)) * 100,
            );
          }
        } else if (SPEED_DIM[state.speed] !== undefined) {
          percent = Math.round(SPEED_DIM[state.speed] * 100);
        }
      }
      if (percent !== null) {
        values.duka_fan_speed = percent;
        // Legacy fallback for a device where the new capability could not be
        // added and dim was kept.
        values.dim = percent / 100;
      }

      if (state.mode !== null && MODE_ID[state.mode] !== undefined) {
        values.duka_mode = MODE_ID[state.mode];
      }

      if (state.humidityThreshold !== null) {
        values.duka_humidity_setpoint = state.humidityThreshold;
      }

      if (state.filterAlarm !== null) values.alarm_filter = state.filterAlarm;

      if (state.filterTimer !== null) {
        values.duka_filter_days = Math.round((state.filterTimer / 1440) * 10) / 10;
      }

      if (state.timerMode !== null && TIMER_MODE_ID[state.timerMode] !== undefined) {
        values.duka_timer_mode = TIMER_MODE_ID[state.timerMode];
      }
      if (state.timerMinutes !== null) values.duka_timer_minutes = state.timerMinutes;
      if (state.schedule !== null) values.duka_schedule = state.schedule;
      if (state.analogLevel !== null) values.duka_analog_level = state.analogLevel;
      if (state.humidityOver !== null) values.duka_humidity_boost = state.humidityOver;
      if (state.analogOver !== null) values.duka_analog_boost = state.analogOver;
      if (state.relayActive !== null) values.duka_relay_active = state.relayActive;
      if (state.alarm !== null) values.alarm_generic = state.alarm !== 0;
    }

    for (const [capability, value] of Object.entries(values)) {
      if (!this.hasCapability(capability)) continue;
      if (this.getCapabilityValue(capability) === value) continue;
      await this.setCapabilityValue(capability, value).catch(this.error);
    }

    await this._syncSettings(state).catch(this.error);
  }

  /**
   * Settings live on the device, so the form follows the unit rather than
   * the other way around. Only differences are written to avoid churn.
   */
  async _syncSettings(state) {
    if (this.family !== 's6w' && this.family !== 'smart') return;

    const desired = {};
    const put = (key, value) => {
      if (value === null || value === undefined) return;
      desired[key] = value;
    };

    if (this.family === 'smart') {
      const offCode = state.turnOffDelay === null ? null : String(state.turnOffDelay);
      const onCode = state.turnOnDelay === null ? null : String(state.turnOnDelay);
      put('humidity_mode', HUMIDITY_MODE_IDS[state.humidityMode]);
      put('humidity_setpoint', state.humiditySetpoint);
      put('temperature_mode', SETTING_MODE_IDS[state.temperatureMode]);
      put('temperature_setpoint', state.temperatureSetpoint);
      put('switch_mode', SETTING_MODE_IDS[state.switchMode]);
      put('interval_percentage', state.intervalPercentage);
      put('silent_enabled', state.silentActive === null ? null : state.silentActive !== false);
      put('silent_start', clockText(state.silentStartSeconds));
      put('silent_end', clockText(state.silentEndSeconds));
      put('turn_off_delay', OFF_DELAY_CODES.has(offCode) ? offCode : null);
      put('turn_on_delay', ON_DELAY_CODES.has(onCode) ? onCode : null);
    } else {
      put('humidity_sensor', state.humiditySensor === null ? null : state.humiditySensor !== 0);
      put('analog_sensor', state.analogSensor === null ? null : state.analogSensor !== 0);
      put('analog_threshold', state.analogThreshold);
      put('relay_sensor', state.relaySensor === null ? null : state.relaySensor !== 0);
      put('boost_delay', state.boostDelay);
      put('night_minutes', state.nightMinutes);
      put('night_hours', state.nightHours);
      put('party_minutes', state.partyMinutes);
      put('party_hours', state.partyHours);
      put('filter_interval', state.filterInterval);
      put('supply_speed_1', state.supplySpeed1);
      put('exhaust_speed_1', state.exhaustSpeed1);
      put('supply_speed_2', state.supplySpeed2);
      put('exhaust_speed_2', state.exhaustSpeed2);
      put('supply_speed_3', state.supplySpeed3);
      put('exhaust_speed_3', state.exhaustSpeed3);
    }

    const current = this.getSettings();
    const changed = {};
    const now = Date.now();
    for (const [key, value] of Object.entries(desired)) {
      // Skip a key whose write just started; a poll that was already on its
      // way must not put the old value back in the form.
      if ((this._settingsHold.get(key) || 0) > now) continue;
      if (current[key] !== value) changed[key] = value;
    }
    if (Object.keys(changed).length) await this.setSettings(changed);
  }

  async _syncMotionCapability() {
    if (this.family !== 'smart' || this.state.isOn === null) return;
    const supported = this.state.motionMode !== null || this.state.motionRunning !== null;
    if (supported === this.hasCapability('duka_motion_active')) return;
    if (supported) await this.addCapability('duka_motion_active').catch(this.error);
    else await this.removeCapability('duka_motion_active').catch(this.error);
  }

  async _applySmartSetting(key, settings) {
    switch (key) {
      case 'humidity_mode':
        await this.client.setHumidityMode(this.state, HUMIDITY_MODE_BY_ID[settings.humidity_mode] || 0);
        break;
      case 'humidity_setpoint':
        await this.client.setHumiditySetpoint(this.state, settings.humidity_setpoint);
        break;
      case 'temperature_mode':
        await this.client.setTemperatureMode(this.state, SETTING_MODE_BY_ID[settings.temperature_mode] || 0);
        break;
      case 'temperature_setpoint':
        await this.client.setTemperatureSetpoint(this.state, settings.temperature_setpoint);
        break;
      case 'switch_mode':
        await this.client.setSwitchMode(this.state, SETTING_MODE_BY_ID[settings.switch_mode] || 0);
        break;
      case 'interval_percentage':
        await this.client.setIntervalPercentage(this.state, settings.interval_percentage);
        break;
      case 'silent_enabled':
        await this.client.setSilentActive(this.state, settings.silent_enabled === true);
        break;
      case 'silent_start':
      case 'silent_end': {
        const start = clockSeconds(settings.silent_start);
        const end = clockSeconds(settings.silent_end);
        if (start === null || end === null) {
          throw new Error('Use HH:MM for the silent window');
        }
        if (start === end) {
          throw new Error('The silent window start and end must differ');
        }
        await this.client.setSilentWindow(this.state, start, end);
        break;
      }
      case 'turn_off_delay':
        await this.client.setTurnOffDelay(this.state, Number(settings.turn_off_delay));
        break;
      case 'turn_on_delay':
        await this.client.setTurnOnDelay(this.state, Number(settings.turn_on_delay));
        break;
      default:
        break;
    }
  }

  async onSettings({ changedKeys, newSettings }) {
    if (this.family !== 's6w' && this.family !== 'smart') return;
    this.state.steps = stepsFromSettings(newSettings);

    await this._enqueue(async () => {
      // The hold starts when the write starts, not when the form is saved.
      const until = Date.now() + SETTINGS_HOLD_MS;
      for (const key of changedKeys) this._settingsHold.set(key, until);

      const keys = new Set(changedKeys);

      if (this.family === 'smart') {
        if (keys.has('silent_start') || keys.has('silent_end')) {
          keys.delete('silent_start');
          keys.delete('silent_end');
          await this._applySmartSetting('silent_start', newSettings);
        }
        for (const key of keys) await this._applySmartSetting(key, newSettings);
        return;
      }

      if (keys.has('night_minutes') || keys.has('night_hours')) {
        keys.delete('night_minutes');
        keys.delete('night_hours');
        await this.client.setNightDuration(
          this.state,
          newSettings.night_minutes,
          newSettings.night_hours,
        );
      }
      if (keys.has('party_minutes') || keys.has('party_hours')) {
        keys.delete('party_minutes');
        keys.delete('party_hours');
        await this.client.setPartyDuration(
          this.state,
          newSettings.party_minutes,
          newSettings.party_hours,
        );
      }

      for (const key of keys) {
        const value = newSettings[key];
        switch (key) {
          case 'humidity_sensor':
            await this.client.setHumiditySensor(this.state, value);
            break;
          case 'analog_sensor':
            await this.client.setAnalogSensor(this.state, value);
            break;
          case 'analog_threshold':
            await this.client.setAnalogThreshold(this.state, value);
            break;
          case 'relay_sensor':
            await this.client.setRelaySensor(this.state, value);
            break;
          case 'boost_delay':
            await this.client.setBoostDelay(this.state, value);
            break;
          case 'filter_interval':
            await this.client.setFilterInterval(this.state, value);
            break;
          default:
            if (STAGE_SETTINGS[key]) {
              await this.client.setStageSpeed(this.state, STAGE_SETTINGS[key], value);
            }
        }
      }
    });
  }

  _checkAvailability() {
    const lastSeen = this.state.lastSeen || this._initAt;
    const offline = Date.now() - lastSeen > OFFLINE_TIMEOUT;

    if (offline && this._available) {
      this._available = false;
      this.setUnavailable('No response from the DUKA unit').catch(this.error);
    } else if (!offline && !this._available) {
      this._available = true;
      this.setAvailable().catch(this.error);
    }

    if (this.family === 's6w' && Date.now() - (this._scheduleReadAt || 0) > SCHEDULE_REFRESH) {
      this._refreshSchedule().catch(this.error);
    }
  }

  _enqueue(task) {
    const run = this._queue.then(task, task);
    this._queue = run.catch(() => {});
    return run;
  }

  async setMode(modeId) {
    if (!this.hasCapability('duka_mode')) {
      throw new Error('This DUKA unit has no ventilation mode');
    }
    const mode = MODE_BY_ID[modeId];
    if (mode === undefined) throw new Error(`Unknown ventilation mode: ${modeId}`);
    return this._enqueue(() => this.client.setMode(this.state, mode));
  }

  async setTimerMode(modeId) {
    if (!this.hasCapability('duka_timer_mode')) {
      throw new Error('This DUKA unit has no timer mode');
    }
    const mode = TIMER_MODE_BY_ID[modeId];
    if (mode === undefined) throw new Error(`Unknown timer mode: ${modeId}`);
    return this._enqueue(() => this.client.setTimerMode(this.state, mode));
  }

  async setSchedule(on) {
    if (!this.hasCapability('duka_schedule')) {
      throw new Error('This DUKA unit has no weekly schedule');
    }
    return this._enqueue(() => this.client.setSchedule(this.state, on));
  }

  async setSchedulePeriod(entry) {
    return this._enqueue(async () => {
      const weekday = Number(entry.weekday);
      const period = Number(entry.period);
      const key = `${weekday}:${period}`;

      // The reserved byte is documented as "any byte" but the unit keeps a
      // value there. Only one entry is read, so a write no longer depends on
      // a complete week read.
      let cached = this._scheduleEntries.get(key);
      if (!cached && weekday >= 1 && weekday <= 7) {
        try {
          cached = await this.client.readScheduleEntry(this.state, weekday, period);
        } catch (err) {
          cached = null;
        }
      }

      const merged = validateScheduleEntry({
        weekday,
        period,
        speed: Number(entry.speed),
        minutes: Number(entry.minutes),
        hours: Number(entry.hours),
        reserved:
          entry.reserved === undefined
            ? cached
              ? cached.reserved
              : 0
            : Number(entry.reserved),
      });

      await this.client.setScheduleEntry(this.state, merged);

      // A group write (all days, Monday to Friday, weekend) is expanded by the
      // unit itself, so the cache is refreshed on the next tick instead of
      // being edited locally.
      if (weekday < 1 || weekday > 7) {
        this._scheduleReadAt = 0;
        return [...this._scheduleEntries.values()];
      }

      this._scheduleEntries.set(key, merged);
      const entries = [...this._scheduleEntries.values()].sort(
        (a, b) => a.weekday - b.weekday || a.period - b.period,
      );
      await this._publishSchedule(entries);
      return entries;
    });
  }

  async readScheduleSummary() {
    return summarizeSchedule(await this.readScheduleQueued());
  }

  async setSpeedPreset(preset) {
    const speed = SPEED_BY_PRESET[preset];
    if (speed === undefined) throw new Error(`Unknown fan speed: ${preset}`);
    return this._enqueue(() => this.client.setSpeed(this.state, speed));
  }

  async setSpeedPercent(value) {
    const speed = value <= 0.25 ? SPEED.LOW : value <= 0.6 ? SPEED.MEDIUM : SPEED.HIGH;
    await this.client.setSpeed(this.state, speed);
  }

  async setManualPercent(percent) {
    if (!this.hasCapability('duka_fan_speed') && !this.hasCapability('dim')) {
      throw new Error('This DUKA unit has no manual fan speed');
    }
    return this._enqueue(async () => {
      if (percent <= 0) {
        await this.client.turnOff(this.state);
        return;
      }
      if (!this.supportsManualSpeed) {
        await this.setSpeedPercent(percent / 100);
        return;
      }
      const value = Math.round((percent / 100) * 255);
      await this.client.setManualSpeed(this.state, value);
    });
  }

  async resetFilter() {
    if (!this.hasCapability('button.reset_filter')) {
      throw new Error('This DUKA unit has no filter timer');
    }
    return this._enqueue(async () => {
      await this.client.resetFilter(this.state);
      if (this.getCapabilityValue('alarm_filter') !== false) {
        await this.setCapabilityValue('alarm_filter', false).catch(this.error);
      }
    });
  }

  async setBoost(on) {
    if (!this.hasCapability('duka_boost')) {
      throw new Error('This DUKA unit has no boost mode');
    }
    return this._enqueue(() => this.client.setBoost(this.state, on));
  }

  async set24h(on) {
    if (!this.hasCapability('duka_24h')) {
      throw new Error('This DUKA unit has no 24 hour mode');
    }
    return this._enqueue(() => this.client.set24h(this.state, on));
  }

  async setIntervalVentilation(on) {
    if (!this.hasCapability('duka_interval')) {
      throw new Error('This DUKA unit has no interval ventilation');
    }
    return this._enqueue(() => this.client.setIntervalVentilation(this.state, on));
  }

  async setSilentSpeed(value) {
    if (!this.hasCapability('duka_silent_speed')) {
      throw new Error('This DUKA unit has no silent speed setting');
    }
    return this._enqueue(() => this.client.setSilentSpeed(this.state, value));
  }

  async setMaxSpeed(value) {
    if (!this.hasCapability('duka_max_speed')) {
      throw new Error('This DUKA unit has no maximum speed setting');
    }
    return this._enqueue(() => this.client.setMaxSpeed(this.state, value));
  }

  async _cleanup() {
    if (this.availabilityTimer) {
      if (typeof this.homey.clearInterval === 'function') {
        this.homey.clearInterval(this.availabilityTimer);
      } else {
        clearInterval(this.availabilityTimer);
      }
      this.availabilityTimer = null;
    }
    if (this.client && this._onUpdate) {
      this.client.removeListener('update', this._onUpdate);
      this._onUpdate = null;
    }
    if (this.client && this._onAddress) {
      this.client.removeListener('address', this._onAddress);
      this._onAddress = null;
    }
    if (this.client) this.client.removeDevice(this.deviceId);
  }

  async onDeleted() {
    await this._cleanup();
  }

  async onUninit() {
    await this._cleanup();
  }
}

module.exports = DukaDevice;
