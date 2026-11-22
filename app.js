'use strict';

const Homey = require('homey');

const { DukaClient, BROADCAST } = require('./lib/duka-client');

const POLL_INTERVAL = 10 * 1000;

class DukaOneApp extends Homey.App {
  async onInit() {
    this.duka = new DukaClient({
      log: (...args) => this.log(...args),
      error: (...args) => this.error(...args),
    });

    this.duka.start().catch((err) => {
      this.error('Duka One network is unavailable:', err.message);
    });

    this.pollTimer = setInterval(() => this._poll(), POLL_INTERVAL);
    this._poll();

    this.log('Duka One app has been initialized');
  }

  _poll() {
    const now = Date.now();
    for (const device of this.duka.devices.values()) {
      // When the unit has not answered lately its address may have changed,
      // so try the broadcast address as well.
      const stale = now - (device.lastSeen || 0) > 30 * 1000;
      this.duka.requestStatus(device, stale ? BROADCAST : null).catch(() => {});
    }

    // The unit only handles one request at a time, so ask for firmware
    // information after the status replies have had a moment to arrive.
    const missingFirmware = [...this.duka.devices.values()].filter((device) => !device.firmwareVersion);
    if (missingFirmware.length > 0) {
      setTimeout(() => {
        for (const device of missingFirmware) {
          if (!this.duka.getDevice(device.id)) continue;
          this.duka.requestFirmware(device).catch(() => {});
        }
      }, 700);
    }
  }

  async onUninit() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.duka) await this.duka.stop();
  }
}

module.exports = DukaOneApp;
