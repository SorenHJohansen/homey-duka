# DUKA for Homey

[![CI](https://github.com/SorenHJohansen/homey-duka/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SorenHJohansen/homey-duka/actions/workflows/ci.yml)

Unofficial [Homey Pro](https://homey.app) app for **DUKA** ventilation units.
The app talks to the unit directly over UDP on your local network, using the
same protocol as the
[Home Assistant integration](https://github.com/dingusdk/ha-dukaone).

> Not affiliated with DUKA Ventilation. Use at your own risk.

## Supported models

- **DUKA One S6W** (unit type 14): fan speed and manual speed, ventilation
  mode, humidity, night and party timers, the humidity, relay and 0-10 V sensor
  inputs with their setpoints, boost delay, filter interval and filter reset,
  and the weekly schedule.
- **DUKA smart fans** (unit type 6): boost, 24-hour mode, interval ventilation,
  silent and maximum speed settings, humidity and temperature control with
  setpoints, the external switch input, the silent window with its start and
  end time, turn-on and turn-off delays, humidity, room temperature, fan RPM
  and the boost countdown. The running speed is automatic; silent and maximum
  define its limits, and the current RPM is shown and recorded in Homey
  Insights.

The app detects the model during pairing and uses the matching driver. Other
unit types are rejected as unsupported.

## Features

- **Fan control** for heat recovery units: on/off, low, medium, high and manual
  speed.
- **Ventilation mode** for heat recovery units: in/out, in and out.
- **Timer modes** for heat recovery units: off, night and party, with the
  remaining time shown and both durations set in the device settings.
- **Sensor inputs** for heat recovery units: humidity, relay and 0-10 V, each
  with an enable switch, a setpoint and a state that shows when the input is
  above its setpoint.
- **Configuration** for heat recovery units in the device settings: humidity
  and 0-10 V setpoints, boost run time, night and party durations, filter
  replacement interval, and the six fan stage speeds.
- **Weekly schedule** for heat recovery units: the whole week is read from the
  unit, the schedule can be switched on and off, a Flow action writes one day
  and period at a time, and a dashboard widget shows the week as a 7 by 4 grid
  where every period can be edited.
- **Smart fan controls**: boost, 24-hour mode, interval ventilation and its
  percentage, silent and maximum speed settings, silent mode with its window,
  humidity and temperature control modes and setpoints, the external switch
  input, and the turn-on and turn-off delays, all in the device settings.
  Boost remaining, silent mode running and interval ventilation running are
  shown on the device, and a motion sensor row appears only when the unit
  reports one.
- **Sensors**: humidity, room temperature and fan RPM, depending on the model.
  The fan RPM is recorded in Homey Insights, so you can see when the fan ran
  and how fast.
- **Reporting deadbands**: humidity, temperature and fan RPM changes are only
  published when they move by at least the configured amount, set per device
  in the device settings.
- **Filter status**: an alarm when the filter needs replacing, the remaining
  filter lifetime in days, and a maintenance action to reset the filter timer.
- **Flow cards** for modes, speeds, timer mode, schedule, boost, 24-hour mode,
  interval ventilation, filter reset and the corresponding triggers.
- **Discovery while pairing**: the app broadcasts on the local network and lists
  the units of the selected model. A device ID and IP address can be entered
  manually.

## Requirements

- Homey Pro (Early 2023 or later) or Homey Self-Hosted Server. The app needs
  LAN access and does not run on Homey Cloud.
- The DUKA unit and Homey on the same network, or a route between them.
- The device ID and password of the unit. The device ID is shown in the DUKA
  mobile app; the default password is `1111`.

## Install

The app is prepared for the Homey App Store. Until it is available there,
install the development build with the Homey CLI:

```bash
npm install --global homey
homey login
git clone https://github.com/SorenHJohansen/homey-duka.git
cd homey-duka
homey app run --remote
```

`--remote` runs the app on the Homey itself, which is required for LAN access.
Use `homey app install` to leave it installed.

## Pairing

1. Open the Homey app and choose **Devices → Add device → DUKA**.
2. Pick **DUKA S6W** or **DUKA smart fan**. The search only lists units of the
   selected model.
3. Press **Search**, or fill in the device ID and IP address manually.
4. Enter the password (default `1111`), give the unit a name and press
   **Add device**.

Discovery uses a UDP broadcast, which stays inside one subnet. If the unit is
on a different VLAN than Homey, enter its IP address manually.

## How it works

The unit listens on UDP port 4000. Packets contain the device ID, the password,
a function code and a list of parameters, with a 16-bit checksum. The app polls
the status every 10 seconds and after every command. Responses are also used to
learn the unit's current IP address.

The firmware reports a unit type. Heat recovery units and smart fans use
different parameter sets, so the app picks the right status request and
capabilities from the detected type.

Parameters carry a page number, and replies can contain size markers and
"not supported" markers. The heat recovery unit is asked for its whole
parameter set, including page 3, in one packet. The weekly schedule is not part
of the status reply: it is read as one day per packet, four periods at a time,
at startup and once an hour.

The protocol implementation lives in
[`lib/duka-protocol.js`](lib/duka-protocol.js), the network client in
[`lib/duka-client.js`](lib/duka-client.js).

## Privacy

The app communicates only with the units on your local network. It does not
send data to any cloud service and does not collect analytics.

The DUKA protocol is plaintext and unauthenticated. The device ID and password
are sent to the unit on your local network, and any device on that network
could spoof a reply. Use the app only on a trusted network.

## Development

```bash
npm test                          # protocol, client and pairing tests
npm run check:source              # every runtime module is tracked in git
npx homey app validate -l verified
npx homey app run --remote        # run on a Homey
```

CI runs `check:source`, the tests, `homey app validate --level verified` and
`homey app build` on every push and pull request. The manual **Release**
workflow bumps the version, commits and tags it, and uploads a draft to the
Homey App Store. It needs a `HOMEY_PAT` repository secret from
https://tools.developer.homey.app/me.

`app.json` is generated from the files in `.homeycompose/` and
`drivers/*/*.compose.json`. Edit those files, not `app.json`.

## Credits

The DUKA One S6W protocol was reverse engineered by
[dukaonesdk](https://github.com/dingusdk/dukaonesdk) and the
[ha-dukaone](https://github.com/dingusdk/ha-dukaone) Home Assistant
integration. The smart fan parameter names follow
[duka_smartfan_sdk](https://github.com/syre/duka_smartfan_sdk). The extended
parameter set, the parameter pages and the weekly schedule follow the
manufacturer's Smart Home connection guide for the Blauberg VENTO units that
the DUKA units are based on, with the parameter table collected in
[duka_connect](https://github.com/HairingX/duka_connect). This app is an
independent JavaScript implementation of the same protocol.

The app image and driver images use product photos from DUKA Ventilation.

## License

GPL-3.0. See [LICENSE](LICENSE).
