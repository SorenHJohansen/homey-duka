'use strict';

const TEMPERATURE_STEP = 0.1;
const RPM_STEP = 100;
const HUMIDITY_STEP = 5;

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
  roundToStep,
  changedByAtLeast,
};
