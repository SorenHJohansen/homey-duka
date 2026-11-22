'use strict';

const DAYS = [
  { weekday: 1, key: 'mon' },
  { weekday: 2, key: 'tue' },
  { weekday: 3, key: 'wed' },
  { weekday: 4, key: 'thu' },
  { weekday: 5, key: 'fri' },
  { weekday: 6, key: 'sat' },
  { weekday: 7, key: 'sun' },
];

const FALLBACK = {
  'widget.schedule.title': 'Schedule',
  'widget.schedule.period': 'Period',
  'widget.schedule.speed': 'Speed',
  'widget.schedule.standby': 'Standby',
  'widget.schedule.refresh': 'Refresh',
  'widget.schedule.hint':
    'Each period ends at its time and runs at its speed until then. 00:00 in the last period means 24:00.',
  'widget.schedule.noDevice': 'Select a DUKA S6W in the widget settings.',
  'widget.schedule.saving': 'Saving...',
  'widget.schedule.failed': 'Could not save.',
  'widget.schedule.mon': 'Mon',
  'widget.schedule.tue': 'Tue',
  'widget.schedule.wed': 'Wed',
  'widget.schedule.thu': 'Thu',
  'widget.schedule.fri': 'Fri',
  'widget.schedule.sat': 'Sat',
  'widget.schedule.sun': 'Sun',
};

let homey = null;
let deviceId = null;
let enabled = false;
let entries = new Map();
let busy = false;
let pendingEntry = null;

const byId = (id) => document.getElementById(id);

function t(key) {
  if (homey && typeof homey.__ === 'function') {
    const value = homey.__(key);
    if (value && value !== key) return value;
  }
  return FALLBACK[key] || key;
}

function showMessage(text, info = false) {
  const element = byId('message');
  if (!text) {
    element.hidden = true;
    element.textContent = '';
    return;
  }
  element.hidden = false;
  element.textContent = text;
  element.classList.toggle('info', info);
}

function setBusy(value) {
  busy = value;
  document.body.dataset.busy = value ? 'true' : 'false';
}

function entryKey(weekday, period) {
  return `${weekday}:${period}`;
}

function timeValue(entry) {
  const hours = String(entry.hours || 0).padStart(2, '0');
  const minutes = String(entry.minutes || 0).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTime(value) {
  const parts = String(value || '00:00').split(':');
  return {
    hours: Math.max(0, Math.min(23, Number(parts[0]) || 0)),
    minutes: Math.max(0, Math.min(59, Number(parts[1]) || 0)),
  };
}

function render() {
  for (const cell of document.querySelectorAll('th[data-period]')) {
    cell.textContent = `${t('widget.schedule.period')} ${cell.dataset.period}`;
  }

  byId('enabled').checked = enabled;
  byId('enabled-label').textContent = t('widget.schedule.title');
  byId('refresh').textContent = t('widget.schedule.refresh');
  byId('hint').textContent = t('widget.schedule.hint');

  const body = document.querySelector('#grid tbody');
  body.textContent = '';

  for (const day of DAYS) {
    const row = document.createElement('tr');
    const label = document.createElement('td');
    label.className = 'day';
    label.textContent = t(`widget.schedule.${day.key}`);
    row.appendChild(label);

    for (let period = 1; period <= 4; period += 1) {
      const entry = entries.get(entryKey(day.weekday, period)) || {
        weekday: day.weekday,
        period,
        speed: 0,
        hours: 0,
        minutes: 0,
      };

      const cell = document.createElement('td');
      const time = document.createElement('input');
      time.type = 'time';
      time.value = timeValue(entry);
      time.setAttribute(
        'aria-label',
        `${t(`widget.schedule.${day.key}`)} ${t('widget.schedule.period')} ${period}`,
      );

      const speed = document.createElement('select');
      speed.setAttribute('aria-label', t('widget.schedule.speed'));
      const options = [
        { value: '0', label: t('widget.schedule.standby') },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
      ];
      for (const option of options) {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        speed.appendChild(element);
      }
      speed.value = String(entry.speed);

      const save = () => {
        const timeParts = parseTime(time.value);
        const next = {
          weekday: day.weekday,
          period,
          speed: Number(speed.value),
          minutes: timeParts.minutes,
          hours: timeParts.hours,
          reserved: entry.reserved,
        };
        return saveEntry(next);
      };

      time.addEventListener('change', save);
      speed.addEventListener('change', save);

      cell.appendChild(time);
      cell.appendChild(speed);
      row.appendChild(cell);
    }

    body.appendChild(row);
  }

  byId('grid').hidden = false;
}

async function load() {
  if (!deviceId) {
    showMessage(t('widget.schedule.noDevice'), true);
    return;
  }

  setBusy(true);
  try {
    const data = await homey.api('GET', `/?deviceId=${encodeURIComponent(deviceId)}`, {});
    enabled = data.schedule === true;
    entries = new Map();
    for (const entry of data.entries || []) {
      entries.set(entryKey(entry.weekday, entry.period), entry);
    }
    showMessage('');
    render();
  } catch (err) {
    showMessage(`${t('widget.schedule.failed')} ${err && err.message ? err.message : ''}`.trim());
  } finally {
    setBusy(false);
  }
}

async function saveEntry(entry) {
  if (!deviceId) return;
  if (busy) {
    pendingEntry = entry;
    return;
  }

  setBusy(true);
  showMessage(t('widget.schedule.saving'), true);
  try {
    const data = await homey.api('PUT', '/entry', { deviceId, entry });
    entries = new Map();
    for (const item of data.entries || []) {
      entries.set(entryKey(item.weekday, item.period), item);
    }
    showMessage('');
    render();
  } catch (err) {
    showMessage(`${t('widget.schedule.failed')} ${err && err.message ? err.message : ''}`.trim());
    await load();
  } finally {
    setBusy(false);
    if (pendingEntry) {
      const next = pendingEntry;
      pendingEntry = null;
      await saveEntry(next);
    }
  }
}

async function saveEnabled(value) {
  if (!deviceId || busy) return;

  setBusy(true);
  try {
    await homey.api('PUT', '/schedule', { deviceId, enabled: value });
    enabled = value;
    showMessage('');
  } catch (err) {
    showMessage(`${t('widget.schedule.failed')} ${err && err.message ? err.message : ''}`.trim());
  } finally {
    setBusy(false);
    render();
  }
}

function onHomeyReady(api) {
  homey = api;
  homey.ready();

  const ids = typeof homey.getDeviceIds === 'function' ? homey.getDeviceIds() : [];
  deviceId = ids && ids.length ? ids[0] : null;

  byId('enabled').addEventListener('change', (event) => {
    saveEnabled(event.target.checked);
  });
  byId('refresh').addEventListener('click', () => {
    load();
  });

  load();
}
