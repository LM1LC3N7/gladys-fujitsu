# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added

- Airstage cloud (Europe and United States): sign-in with the e-mail, password
  and country of the Airstage app, tokens kept in `/data` and refreshed, the
  units read every 2 minutes, commands sent as requests and followed until the
  unit took them.
- Airstage Wi-Fi adapters on the LAN (IP address + MAC address in the
  configuration): read every 30 seconds, commands sent directly, HTTPS when
  HTTP is refused. A unit of the Airstage account with its adapter in the list
  is one device, driven locally while the adapter answers (the "Prefer the
  local connection" toggle), the cloud taking over when it fails.
- FGLair cloud (Europe and the other regions): sign-in with the account of the
  FGLair app, the units read every 5 minutes and a few seconds after a
  command, commands sent as datapoints.
- One Gladys air conditioner per indoor unit, with the features the unit has:
  on/off, mode (auto, cool, heat, dry, fan), setpoint (half degrees), fan
  speed, vertical swing and positions, horizontal swing, economy, powerful,
  outdoor unit low noise, energy saving fan, minimum heat (10 °C), indoor and
  outdoor temperatures, error code.
- Connection status per source, local/cloud/unreachable transport badges
  (degraded when a unit falls back to its other way), "Test the connection"
  button.
- A refused password is never retried on its own; HTTP 429 waits what the
  service asks (up to one hour).

[Unreleased]: https://github.com/LM1LC3N7/gladys-fujitsu/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-fujitsu/releases/tag/v0.1.1
