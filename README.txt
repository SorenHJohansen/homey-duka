DUKA

Control DUKA ventilation units from Homey over your local network. The app
talks directly to the unit over UDP, without a cloud service.

SUPPORTED MODELS

- DUKA One S6W and related heat recovery units: fan speed, ventilation mode,
  humidity, filter status and filter reset.
- DUKA smart fans: boost, 24-hour mode, interval ventilation, silent and
  maximum speed settings, humidity, room temperature and fan RPM.

The app detects the model during pairing and enables only the controls the unit
reports.

FEATURES

- Fan control: on/off, low, medium, high and manual speed on heat recovery
  units.
- Ventilation mode: in/out, in and out on heat recovery units.
- Smart fan controls: boost, 24-hour mode, interval ventilation, silent and
  maximum speed settings.
- Sensors: humidity, room temperature and fan RPM, depending on the model.
- Filter alarm and remaining filter lifetime, with a maintenance action to
  reset the filter timer.
- Flow cards for modes, speeds, boost, 24-hour mode, interval ventilation,
  filter reset and the corresponding triggers.
- Network discovery during pairing, with manual device ID and IP entry as a
  fallback.

REQUIREMENTS

- Homey Pro (Early 2023 or later) or Homey Self-Hosted Server, with LAN access.
  The app does not work on Homey Cloud.
- The DUKA unit on the same network, or reachable through a route.
- The device ID from the DUKA mobile app. The default password is 1111.

PRIVACY

The app communicates only with the units on your local network. It does not
send data to any cloud service and does not collect analytics.

This is an unofficial app and is not affiliated with DUKA Ventilation. The
protocol was documented by the ha-dukaone project.

Source code and issue tracker:
https://github.com/SorenHJohansen/homey-dukaone
