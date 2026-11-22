'use strict';

const Homey = require('homey');

const { SPEED, MODE } = require('../../lib/duka-protocol');

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

class DukaOneDevice extends Homey.Device {
  async onInit() {
    this.deviceId = String(this.getData().id || '').trim().toUpperCase();
    this.client = this.homey.app.duka;

    this.state = this.client.registerDevice({
      id: this.deviceId,
      password: this.getStoreValue('password') || '1111',
      address: this.getStoreValue('address') || null,
    });

    this._available = true;
    this._initAt = Date.now();

    this._onUpdate = (device) => {
      if (device.id !== this.deviceId) return;
      this._applyState(device).catch(this.error);
    };
    this.client.on('update', this._onUpdate);

    this._onAddress = (device) => {
      if (device.id !== this.deviceId) return;
      this.setStoreValue('address', device.address).catch(this.error);
    };
    this.client.on('address', this._onAddress);

    this.registerCapabilityListener('onoff', async (value) => {
      if (value) await this.client.turnOn(this.state);
      else await this.client.turnOff(this.state);
    });

    this.registerCapabilityListener('dim', async (value) => {
      if (value <= 0) {
        await this.client.turnOff(this.state);
        return;
      }
      await this.client.setManualSpeed(this.state, Math.round(value * 255));
    });

    this.registerCapabilityListener('dukaone_mode', async (value) => {
      await this.setMode(value);
    });

    this.registerCapabilityListener('button.reset_filter', async () => {
      await this.resetFilter();
    });

    this.availabilityTimer = setInterval(() => this._checkAvailability(), AVAILABILITY_INTERVAL);

    await this._applyState(this.state);
  }

  async _applyState(state) {
    if (!this._available) {
      await this.setAvailable().catch(this.error);
      this._available = true;
    }

    const values = {};

    if (state.isOn !== null) values.onoff = state.isOn;

    if (state.speed !== null) {
      if (state.speed === SPEED.OFF) {
        values.dim = 0;
      } else if (state.speed === SPEED.MANUAL) {
        if (typeof state.manualSpeed === 'number') {
          values.dim = Math.min(1, Math.max(0.01, state.manualSpeed / 255));
        }
      } else if (SPEED_DIM[state.speed] !== undefined) {
        values.dim = SPEED_DIM[state.speed];
      }
    }

    if (state.mode !== null && MODE_ID[state.mode] !== undefined) {
      values.dukaone_mode = MODE_ID[state.mode];
    }

    if (state.humidity !== null) values.measure_humidity = state.humidity;
    if (state.filterAlarm !== null) values.alarm_filter = state.filterAlarm;

    if (state.filterTimer !== null) {
      values.dukaone_filter_days = Math.round((state.filterTimer / 1440) * 10) / 10;
    }

    for (const [capability, value] of Object.entries(values)) {
      if (!this.hasCapability(capability)) continue;
      if (this.getCapabilityValue(capability) === value) continue;
      await this.setCapabilityValue(capability, value).catch(this.error);
    }
  }

  _checkAvailability() {
    const lastSeen = this.state.lastSeen || this._initAt;
    const offline = Date.now() - lastSeen > OFFLINE_TIMEOUT;

    if (offline && this._available) {
      this._available = false;
      this.setUnavailable('No response from the Duka One unit').catch(this.error);
    } else if (!offline && !this._available) {
      this._available = true;
      this.setAvailable().catch(this.error);
    }
  }

  async setMode(modeId) {
    const mode = MODE_BY_ID[modeId];
    if (mode === undefined) throw new Error(`Unknown ventilation mode: ${modeId}`);
    await this.client.setMode(this.state, mode);
  }

  async setSpeedPreset(preset) {
    const speed = SPEED_BY_PRESET[preset];
    if (speed === undefined) throw new Error(`Unknown fan speed: ${preset}`);
    await this.client.setSpeed(this.state, speed);
  }

  async setManualPercent(percent) {
    if (percent <= 0) {
      await this.client.turnOff(this.state);
      return;
    }
    const value = Math.round((percent / 100) * 255);
    await this.client.setManualSpeed(this.state, value);
  }

  async resetFilter() {
    await this.client.resetFilter(this.state);
    if (this.getCapabilityValue('alarm_filter') !== false) {
      await this.setCapabilityValue('alarm_filter', false).catch(this.error);
    }
  }

  async _cleanup() {
    if (this.availabilityTimer) {
      clearInterval(this.availabilityTimer);
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

module.exports = DukaOneDevice;
