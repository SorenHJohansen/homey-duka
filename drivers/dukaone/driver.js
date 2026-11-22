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

      // Only expose the capabilities the unit actually reports. The S6W
      // family answers everything; simpler one-way units answer on/off and
      // speed only.
      const capabilities = ['onoff'];
      if (info.speed !== null) capabilities.push('dim');
      if (info.mode !== null) capabilities.push('dukaone_mode');
      if (info.humidity !== null) capabilities.push('measure_humidity');
      if (info.filterAlarm !== null) capabilities.push('alarm_filter');
      if (info.filterTimer !== null) capabilities.push('dukaone_filter_days');
      if (info.filterAlarm !== null || info.filterTimer !== null) {
        capabilities.push('button.reset_filter');
      }

      return {
        id: deviceId,
        password,
        address: info.address || address || '',
        firmware: info.firmwareVersion || null,
        unitType: info.unitType === null ? null : info.unitType,
        capabilities,
        manualSpeed: info.manualSpeed !== null,
      };
    });
  }
}

module.exports = DukaOneDriver;
