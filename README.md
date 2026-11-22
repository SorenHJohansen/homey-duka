# Duka One for Homey

Unofficial [Homey Pro](https://homey.app) app for **Duka One** ventilation units
(Duka One S6W and related models). The app talks to the unit directly over UDP
on your local network, using the same protocol as the
[Home Assistant integration](https://github.com/dingusdk/ha-dukaone).

> Not affiliated with Duka Ventilation. Use at your own risk.

## Features

- **Fan control** from the device tile: on/off, low, medium, high and manual
  speed via the speed slider.
- **Ventilation mode**: in/out (heat recovery), in (supply air) and out
  (exhaust air).
- **Humidity sensor** from the unit's built-in sensor.
- **Filter status**: an alarm when the filter needs replacing and the remaining
  filter lifetime in days.
- **Filter reset** as a maintenance action on the device page.
- **Flow cards**: set mode, set speed, set manual speed, reset the filter timer,
  and triggers for mode changes and filter alarms.
- **Discovery while pairing**: the app broadcasts on the local network and lists
  the units that answer. You can also enter the device ID and IP address
  manually.

## Requirements

- Homey Pro (Early 2023 or later) or Homey Self-Hosted Server. The app needs
  LAN access, so it does not run on Homey Cloud.
- The Duka One unit and Homey on the same network, or a route between them.
- The device ID and password of the unit. The device ID is shown in the Duka
  One mobile app; the default password is `1111`.

## Install

The app is not in the Homey App Store (yet). Install it with the Homey CLI:

```bash
npm install --global homey
homey login
git clone https://github.com/SorenHJohansen/homey-dukaone.git
cd homey-dukaone
homey app run
```

`homey app run` builds the app, installs it on the selected Homey and streams
the logs. Press `Ctrl+C` to stop it (this uninstalls the development build).
Use `homey app install` to leave it installed.

## Pairing

1. Open the Homey app and choose **Devices → Add device → Duka One**.
2. Press **Search**. Units that answer are listed with their device ID and IP;
   pick one, or fill in the fields by hand.
3. Enter the password (default `1111`), give the unit a name and press
   **Add device**.

Discovery uses a UDP broadcast, which stays inside one subnet. If the unit is
on a different VLAN than Homey, enter its IP address manually.

## How it works

The unit listens on UDP port 4000. Packets contain the device ID, the password,
a function code and a list of parameters, with a 16-bit checksum. The app polls
the status every 10 seconds and after every command. Responses are also used to
learn the unit's current IP address, so a DHCP lease change does not break the
device.

The protocol implementation lives in [`lib/duka-protocol.js`](lib/duka-protocol.js),
the network client in [`lib/duka-client.js`](lib/duka-client.js).

## Development

```bash
npm test                          # protocol unit tests
npx homey app validate -l debug   # validate the app manifest
npx homey app run                 # run on a Homey
```

`app.json` is generated from the files in `.homeycompose/` and
`drivers/*/*.compose.json`. Edit those files, not `app.json`.

### Troubleshooting the CLI

If you run the CLI with `--path` from outside the app folder and the build
fails with `EACCES: permission denied, mkdir '/home/tmp'`, this is a Homey CLI
4.6.3 bug: it resolves the empty line in the output of `npm ls` against the
current directory. Run the command from inside the app folder instead, or
filter empty lines before `path.relative` in the CLI's `lib/NpmCommands.js`.

## Credits

The Duka One protocol was reverse engineered by the
[ha-dukaone](https://github.com/dingusdk/ha-dukaone) project and its Python
`dukaonesdk`. This app is an independent JavaScript implementation of the same
protocol.

## License

GPL-3.0. See [LICENSE](LICENSE).
