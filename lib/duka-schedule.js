'use strict';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatTime(entry) {
  // The last period of a day is written with 00:00, meaning 24:00.
  if (entry.hours === 0 && entry.minutes === 0) return '24:00';
  const hours = String(entry.hours).padStart(2, '0');
  const minutes = String(entry.minutes).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatSpeed(speed) {
  return speed === 0 ? 'off' : `S${speed}`;
}

/**
 * Turn the 28 schedule entries into one readable line. Each period ends at
 * the given time, so an entry is written as end time plus the speed it runs
 * from the previous period's end until then.
 */
function summarizeSchedule(entries) {
  const byDay = new Map();
  for (const entry of entries) {
    if (entry.weekday < 1 || entry.weekday > 7) continue;
    if (!byDay.has(entry.weekday)) byDay.set(entry.weekday, []);
    byDay.get(entry.weekday).push(entry);
  }

  const parts = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const day = byDay.get(weekday) || [];
    if (!day.length) continue;
    day.sort((a, b) => a.period - b.period);
    const text = day
      .map((entry) => `${formatTime(entry)} ${formatSpeed(entry.speed)}`)
      .join(', ');
    parts.push(`${DAY_NAMES[weekday - 1]} ${text}`);
  }

  return parts.join('; ');
}

module.exports = { summarizeSchedule, DAY_NAMES };
