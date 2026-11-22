'use strict';

const Homey = require('homey');

const { createPairHandlers } = require('../../lib/duka-pair');

class DukaOneSmartDriver extends Homey.Driver {
  async onInit() {
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
      await args.device.setIntervalVentilation(args.state === 'on');
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
    createPairHandlers(this, session, 'smart');
  }
}

module.exports = DukaOneSmartDriver;
