'use strict';

function deviceFor(homey, deviceId) {
  if (!deviceId) throw new Error('No DUKA S6W device selected');
  const driver = homey.drivers.getDriver('duka');
  const device = driver.getDevice({ id: deviceId });
  if (!device) throw new Error('The selected device is not a DUKA S6W');
  return device;
}

module.exports = {
  async getSchedule({ homey, query }) {
    const device = deviceFor(homey, query.deviceId);
    const entries = await device.readScheduleEntries();
    return {
      schedule: device.getCapabilityValue('duka_schedule') === true,
      entries,
    };
  },

  async setEntry({ homey, body }) {
    const device = deviceFor(homey, body.deviceId);
    const entries = await device.setSchedulePeriod(body.entry);
    return { entries };
  },

  async setSchedule({ homey, body }) {
    const device = deviceFor(homey, body.deviceId);
    const enabled = body.enabled === true;
    await device.setSchedule(enabled);
    return { schedule: enabled };
  },
};
