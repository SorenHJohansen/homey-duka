'use strict';

const SMART_TYPE = 6;
const S6W_TYPE = 14;

/**
 * Map a unit type to a family.
 * - smart: the smart fan firmware
 * - s6w: the heat recovery firmware we support
 * - null: the unit did not report a type, so the selected driver decides
 * - unsupported: a known type that this app does not support
 */
function familyForUnitType(unitType) {
  if (unitType === null || unitType === undefined) return null;
  if (unitType === SMART_TYPE) return 'smart';
  if (unitType === S6W_TYPE) return 's6w';
  return 'unsupported';
}

/**
 * A unit with an unknown family is listed under both drivers so the user can
 * still pair it. The selected driver is used as the fallback.
 */
function matchesFamily(deviceFamily, selectedFamily) {
  return deviceFamily === selectedFamily || deviceFamily === null;
}

module.exports = { familyForUnitType, matchesFamily, SMART_TYPE, S6W_TYPE };
