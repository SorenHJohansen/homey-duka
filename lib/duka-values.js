'use strict';

const TEMPERATURE_STEP = 0.1;
const RPM_STEP = 100;

function roundToStep(value, step) {
  return Math.round(value / step) * step;
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
  roundToStep,
  changedByAtLeast,
};
