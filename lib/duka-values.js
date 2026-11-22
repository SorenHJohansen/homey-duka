'use strict';

const TEMPERATURE_STEP = 0.1;
const RPM_STEP = 100;
const HUMIDITY_STEP = 5;

const STEP_LIMITS = {
  humidity: { min: 1, max: 25, fallback: HUMIDITY_STEP },
  temperature: { min: 0.1, max: 5, fallback: TEMPERATURE_STEP },
  rpm: { min: 10, max: 2000, fallback: RPM_STEP },
};

function clampStep(value, limit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return limit.fallback;
  return Math.min(limit.max, Math.max(limit.min, number));
}

/**
 * Turn the device settings into the three publish thresholds. Values outside
 * the supported range fall back to the default, so a bad form entry cannot
 * stop the unit's readings from being published.
 */
function stepsFromSettings(settings = {}) {
  return {
    humidity: clampStep(settings.humidity_step, STEP_LIMITS.humidity),
    temperature: clampStep(settings.temperature_step, STEP_LIMITS.temperature),
    rpm: clampStep(settings.rpm_step, STEP_LIMITS.rpm),
  };
}

function roundToStep(value, step) {
  // Avoid float noise such as 14.000000000000002 from a 0.1 step.
  return Number((Math.round(value / step) * step).toFixed(6));
}

/**
 * True when a new numeric reading is different enough to publish.
 * A zero reading can be treated as a state change of its own so the fan
 * tile still shows the fan stopping.
 */
function changedByAtLeast(current, next, step, zeroIsSpecial = false) {
  if (next === null || next === undefined) return false;
  if (zeroIsSpecial && next === 0) return current !== 0;
  if (current === null || current === undefined) return true;
  return Math.abs(next - current) >= step;
}

module.exports = {
  TEMPERATURE_STEP,
  RPM_STEP,
  HUMIDITY_STEP,
  STEP_LIMITS,
  stepsFromSettings,
  roundToStep,
  changedByAtLeast,
};
