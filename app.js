'use strict';

const Homey = require('homey');

const { DukaClient } = require('./lib/duka-client');

const POLL_INTERVAL = 10 * 1000;

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
      // When the address is unknown or the unit has not answered lately, use
      // the search packet instead of broadcasting a packet with credentials.
      if (!device.address || now - (device.lastSeen || 0) > 30 * 1000) {
        needsDiscovery = true;
        continue;
      }
      this.duka.requestStatus(device).catch(() => {});
    }

    if (needsDiscovery) this.duka.discover().catch(() => {});

    // The unit only handles one request at a time, so ask for firmware
    // information after the status replies have had a moment to arrive.
    const missingFirmware = [...this.duka.devices.values()].filter(
      (device) => device.address && !device.firmwareVersion,
    );
    if (missingFirmware.length > 0) {
      const schedule =
        typeof this.homey.setTimeout === 'function'
          ? this.homey.setTimeout.bind(this.homey)
          : setTimeout;
      schedule(() => {
        for (const device of missingFirmware) {
          if (!this.duka.getDevice(device.id)) continue;
          this.duka.requestFirmware(device).catch(() => {});
        }
      }, 700);
    }
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
