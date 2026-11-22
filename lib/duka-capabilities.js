'use strict';

// Capabilities each device should have. Homey only applies the driver
// manifest when a device is paired, so devices paired before a capability was
// added have to be brought up to date at startup.
const S6W_CAPABILITIES = [
  'onoff',
  'duka_fan_speed',
  'duka_humidity_setpoint',
  'measure_humidity',
  'duka_mode',
  'duka_timer_mode',
  'duka_timer_minutes',
  'duka_schedule',
  'duka_schedule_text',
  'duka_analog_level',
  'duka_humidity_boost',
  'duka_analog_boost',
  'duka_relay_active',
  'alarm_generic',
  'alarm_filter',
  'duka_filter_days',
  'button.reset_filter',
];

const SMART_CAPABILITIES = [
  'onoff',
  'measure_humidity',
  'measure_temperature',
  'duka_boost',
  'duka_24h',
  'duka_interval',
  'duka_silent_speed',
  'duka_max_speed',
  'measure_fan_rpm',
  'duka_boost_minutes',
  'duka_silent_active',
  'duka_interval_active',
];

module.exports = { S6W_CAPABILITIES, SMART_CAPABILITIES };
