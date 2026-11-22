'use strict';

const Homey = require('homey');

class DukaOneDriver extends Homey.Driver {
  async onInit() {
    const setMode = this.homey.flow.getActionCard('set_mode');
    setMode.registerRunListener(async (args) => {
      await args.device.setMode(args.mode);
    });

    const setSpeed = this.homey.flow.getActionCard('set_speed');
    setSpeed.registerRunListener(async (args) => {
      await args.device.setSpeedPreset(args.speed);
    });

    const setManualSpeed = this.homey.flow.getActionCard('set_manual_speed');
    setManualSpeed.registerRunListener(async (args) => {
      await args.device.setManualPercent(args.speed);
    });

    const resetFilter = this.homey.flow.getActionCard('reset_filter');
    resetFilter.registerRunListener(async (args) => {
      await args.device.resetFilter();
    });
  }

  async onPair(session) {
    session.setHandler('search', async () => {
      return this.homey.app.duka.search(5000);
    });

    session.setHandler('add', async (data) => {
      const deviceId = String((data && data.deviceId) || '').trim().toUpperCase();
      if (!deviceId) throw new Error(this.homey.__('pair.errors.device_id'));

      const password = String((data && data.password) || '').trim() || '1111';
      const address = String((data && data.address) || '').trim() || null;

      const info = await this.homey.app.duka.probe({
        id: deviceId,
        password,
        address,
      });

      return {
        id: deviceId,
        password,
        address: info.address || address || '',
        firmware: info.firmwareVersion || null,
        unitType: info.unitType === null ? null : info.unitType,
      };
    });
  }
}

module.exports = DukaOneDriver;
