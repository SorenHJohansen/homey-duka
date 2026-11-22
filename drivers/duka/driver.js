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

    const setTimerMode = this.homey.flow.getActionCard('set_timer_mode');
    setTimerMode.registerRunListener(async (args) => {
      await args.device.setTimerMode(args.mode);
    });

    const setSchedule = this.homey.flow.getActionCard('set_schedule');
    setSchedule.registerRunListener(async (args) => {
      await args.device.setSchedule(args.state === 'on');
    });

    const setSchedulePeriod = this.homey.flow.getActionCard('set_schedule_period');
    setSchedulePeriod.registerRunListener(async (args) => {
      await args.device.setSchedulePeriod(args);
    });

    const readSchedule = this.homey.flow.getActionCard('read_schedule');
    readSchedule.registerRunListener(async (args) => {
      const summary = await args.device.readScheduleSummary();
      return { summary };
    });
  }

  async onPair(session) {
    createPairHandlers(this, session, 's6w');
  }
}

module.exports = DukaS6WDriver;
