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

    const setBoost = this.homey.flow.getActionCard('set_boost');
    setBoost.registerRunListener(async (args) => {
      await args.device.setBoost(args.state === 'on');
    });

    const set24h = this.homey.flow.getActionCard('set_24h');
    set24h.registerRunListener(async (args) => {
      await args.device.set24h(args.state === 'on');
    });

    const setInterval = this.homey.flow.getActionCard('set_interval');
    setInterval.registerRunListener(async (args) => {
      await args.device.setInterval(args.state === 'on');
    });

    const setSilentSpeed = this.homey.flow.getActionCard('set_silent_speed');
    setSilentSpeed.registerRunListener(async (args) => {
      await args.device.setSilentSpeed(args.speed);
    });

    const setMaxSpeed = this.homey.flow.getActionCard('set_max_speed');
    setMaxSpeed.registerRunListener(async (args) => {
      await args.device.setMaxSpeed(args.speed);
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
      // family answers everything; the smart fan answers its own set.
      const family = info.family || (info.unitType === 6 ? 'smart' : 's6w');
      let capabilities;

      if (family === 'smart') {
        capabilities = [
          'onoff',
          'dukaone_boost',
          'dukaone_24h',
          'dukaone_interval',
          'dukaone_silent_speed',
          'dukaone_max_speed',
          'dukaone_fan_rpm',
        ];
        if (info.humidity !== null) capabilities.push('measure_humidity');
        if (info.temperature !== null) capabilities.push('measure_temperature');
      } else {
        capabilities = ['onoff'];
        if (info.speed !== null) capabilities.push('dim');
        if (info.mode !== null) capabilities.push('dukaone_mode');
        if (info.humidity !== null) capabilities.push('measure_humidity');
        if (info.filterAlarm !== null) capabilities.push('alarm_filter');
        if (info.filterTimer !== null) capabilities.push('dukaone_filter_days');
        if (info.filterAlarm !== null || info.filterTimer !== null) {
          capabilities.push('button.reset_filter');
        }
      }

      return {
        id: deviceId,
        password,
        address: info.address || address || '',
        firmware: info.firmwareVersion || null,
        unitType: info.unitType === null ? null : info.unitType,
        family,
        capabilities,
        manualSpeed: info.manualSpeed !== null,
      };
    });
  }
}

module.exports = DukaOneDriver;
