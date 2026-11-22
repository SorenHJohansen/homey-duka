'use strict';

const Homey = require('homey');

const { createPairHandlers } = require('../../lib/duka-pair');

class DukaS6WDriver extends Homey.Driver {
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
    createPairHandlers(this, session, 's6w');
  }
}

module.exports = DukaS6WDriver;
