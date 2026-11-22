'use strict';

const Homey = require('homey');

const { DukaClient } = require('./lib/duka-client');
const {
  FRESH_INTERVAL,
  pollIntervalForAge,
  firmwareRetryInterval,
} = require('./lib/duka-backoff');

const POLL_INTERVAL = FRESH_INTERVAL;

class DukaApp extends Homey.App {
  async onInit() {
    const setTimeoutFn =
      typeof this.homey.setTimeout === 'function'
        ? this.homey.setTimeout.bind(this.homey)
        : undefined;
    const clearTimeoutFn =
      typeof this.homey.clearTimeout === 'function'
        ? this.homey.clearTimeout.bind(this.homey)
        : undefined;

    this.duka = new DukaClient({
      log: (...args) => this.log(...args),
      error: (...args) => this.error(...args),
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
    });

    this.duka.start().catch((err) => {
      this.error('DUKA network is unavailable:', err.message);
    });

    this.pollTimer =
      typeof this.homey.setInterval === 'function'
        ? this.homey.setInterval(() => this._poll(), POLL_INTERVAL)
        : setInterval(() => this._poll(), POLL_INTERVAL);
    this._poll();

    this.log('DUKA app has been initialized');
  }

  _poll() {
    const now = Date.now();
    let needsDiscovery = false;

    for (const device of this.duka.devices.values()) {
      // A schedule read owns the link while it runs.
      if (device.scheduleBusy) continue;

      const lastActivity = device.lastSeen || device.createdAt || now;
      const age = now - lastActivity;
      // Subtract a second so timer jitter does not skip every other poll.
      if (device.lastPollAt && now - device.lastPollAt < pollIntervalForAge(age) - 1000) {
        continue;
      }
      device.lastPollAt = now;

      // Learn a stale address with the search packet, which has no password.
      if (!device.address || age > 30 * 1000) {
        needsDiscovery = true;
        continue;
      }

      this.duka.requestStatus(device).catch(() => {});

      // Firmware is informational. Keep the status request first and retry
      // the firmware only a few times, then at a slow interval.
      if (!device.firmwareVersion) {
        const retry = firmwareRetryInterval(device.firmwareAttempts || 0);
        if (now - (device.firmwareRequestedAt || 0) >= retry) {
          device.firmwareRequestedAt = now;
          device.firmwareAttempts = (device.firmwareAttempts || 0) + 1;
          this.duka.requestFirmware(device).catch(() => {});
        }
      }
    }

    if (needsDiscovery) this.duka.discover().catch(() => {});
  }

  async onUninit() {
    if (this.pollTimer) {
      if (typeof this.homey.clearInterval === 'function') {
        this.homey.clearInterval(this.pollTimer);
      } else {
        clearInterval(this.pollTimer);
      }
    }
    if (this.duka) await this.duka.stop();
  }
}

module.exports = DukaApp;
