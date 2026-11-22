'use strict';

const FRESH_INTERVAL = 15 * 1000;
const OFFLINE_INTERVAL = 30 * 1000;
const LONG_OFFLINE_INTERVAL = 2 * 60 * 1000;
const FIRMWARE_INTERVAL = 30 * 1000;
const FIRMWARE_SLOW_INTERVAL = 5 * 60 * 1000;

function pollIntervalForAge(age) {
  if (age > 15 * 60 * 1000) return LONG_OFFLINE_INTERVAL;
  if (age > 60 * 1000) return OFFLINE_INTERVAL;
  return FRESH_INTERVAL;
}

function firmwareRetryInterval(attempts) {
  return attempts >= 3 ? FIRMWARE_SLOW_INTERVAL : FIRMWARE_INTERVAL;
}

module.exports = {
  FRESH_INTERVAL,
  pollIntervalForAge,
  firmwareRetryInterval,
};
