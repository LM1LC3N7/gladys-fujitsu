# TODO — Fujitsu Airstage & FGLair v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #224) gets one recap message there, with
  a link to each repo, once published.

## Status

- [x] **Milestone 1 — the three sources** (2026-10-16): Airstage cloud client
      (sign-in, kept and refreshed tokens, device list, set request + its
      status), Airstage Wi-Fi adapter client (GetParam / SetParam, header case,
      pause, retry after a dropped connection, HTTPS fallback), FGLair (Ayla)
      client (sign-in per region, refresh, devices, properties, datapoints,
      room temperature refresh), one entry per indoor unit (cloud and adapter
      of the same MAC merged, local preferred with the cloud as a fallback
      and degraded badges), AIR_CONDITIONING device with on/off, mode,
      setpoint, fan speed, vertical swing and positions, horizontal swing,
      economy, powerful, outdoor low noise, energy saving fan, minimum heat,
      indoor/outdoor temperatures, error code; status per source, test button,
      manifest, docs en/fr. Tests: JSON fixtures shaped after the reference
      projects, fake clouds, fake adapters on the loopback (real HTTP), SDK
      fake Gladys. Docker image checked read-only under 256 MB / 0.5 CPU
      (`~/gladys-integrations/e2e/fujitsu-image-check.sh`). No real unit or
      account yet.
- [ ] **Milestone 2 — real units**: see "To check on a real unit or account";
      collect `devices/all`, GetParam and FGLair `properties.json` answers from
      testers as fixtures (without tokens); fix what differs.
- [ ] **Milestone 3 — more**: Airstage power consumption (`iu_pow_cons`, read
      without `iu_hmn_det`), human detection and its auto save
      (`iu_hmn_det`, `iu_hmn_det_auto_save`), horizontal positions
      (`iu_af_dir_hrz`), Wi-Fi LED (`iu_wifi_led`), filter sign
      (`iu_fltr_sign_reset`); FGLair vertical/horizontal positions
      (`af_vertical_direction`…), minimum heat and energy saving fan once their
      property names are known (capability bits 13 and 14 exist); FGLair China
      region (the references disagree on its hosts); scene triggers for the
      error code.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).

## To check on a real unit or account

- Airstage cloud: the sign-in with the pyairstage headers only (no
  `sec-fetch-*`), the `country` value (English name, "France"), the token
  lifetime and the refresh, `limit=50`, the shape of `devices/all` (is
  `connectionStatus` "Online"/"Offline"? is `deviceId` the MAC, as
  homebridge-fujitsu-airstage pairs it with the LAN devices?), a request
  status `result` other than "success", how fast `requests/<id>` completes,
  the rate limit before an IP ban (homebridge-fujitsu-airstage warns about
  short polling; ha_airstage polls every 2 minutes), several parameters in one
  set request.
- Adapter: several values in one SetParam (sent when a position also stops the
  swing), `device_sub_id` 0 as a number (homebridge-fujitsu-airstage sends
  "0"), which adapters answer in HTTPS, the answer time (Home Assistant
  allows 20 s), the swing positions count `iu_af_inc_vrt` (4, 6, 8) and the
  direction values when swinging, the horizontal swing name (pyairstage swaps
  `iu_af_swg_hrz` and `iu_af_dir_hrz`; the vertical pattern is used here),
  `iu_err_code` values (is "0" no error?), temperatures reading "65535" while
  the unit is off.
- FGLair: the EU device host (`ads-eu`, as Home Assistant; homebridge uses
  `ads-field-eu`, the same ingress on 2026-10-16), the token lifetime, the
  `refresh` datapoint every 5 minutes, `operation_mode` 1 to turn on (the
  last mode is sent when known), the economy / powerful / outdoor low-noise
  property names and values on A, B and F modules, the B module swing value 3,
  a property named `SET_…` on some modules.
- Two clients on one account (Gladys and the app, or two Gladys): do the
  Airstage or Ayla sessions cut each other?

## Decisions

- **No duplicate** (checked 2026-10-16): the store index (433 entries,
  generated 2026-10-16T11:15Z) has no Fujitsu, Airstage or FGLair integration;
  the Gladys core (master 0027571, `server/services`) has none either (AC only
  in melcloud, matter); a GitHub search for "gladys fujitsu" / "gladys
  airstage" finds only this repository; the main session checked the forum
  and the tracker (P2 n° 458) before the claim in /t/10385 #224. Atlantic
  units of the Cozytouch app are covered by cicoub13/gladys-overkiz: said in
  the docs, the manifest and the README.
- **Both clouds and the Airstage local API in milestone 1**: European
  installations have both the Airstage app (newer units, Europe cloud) and
  the FGLair app (older modules, still common in Europe); the Airstage
  adapters have a documented local API implemented by two references, the
  preferred transport. The FGLair LAN mode makes the unit call an HTTP server
  of the client (homebridge-fujitsu-hvac `localServer.ts`, key exchange): the
  Gladys container publishes no inbound port, so FGLair is cloud only.
- **Own clients, no Fujitsu dependency** (Louis's reuse rule):
  - homebridge-fujitsu-airstage 4.0.0 (MIT, Homebridge verified, 2026-10-01,
    no runtime dependency) is a plugin, not a library: `main` is the plugin,
    the `src/airstage` clients are internal; they are callback-based with a
    cache built for HomeKit accessories, `JSON.parse` of a non-JSON answer
    throws inside a socket callback (it would crash the container), the
    request status is polled without delay nor limit, no 429 handling. Its
    cloud and LAN API is **ported** (credited in NOTICE and README).
  - pyairstage 3.2.2 (MIT, 2026-08, Python, used by ha_airstage 1.9.0):
    reference for the extra parameters, the adapter limits and HTTPS.
  - `fglair` npm 1.0.7 (ISC, one release in 2025-04, node-fetch 2): mode, fan
    and temperatures only, no tests, and its login sends the password to the
    three regions in turn: reference only.
  - homebridge-fujitsu-hvac 1.4.3 (MIT, 2026-01): TypeScript plugin, used to
    cross-check the Ayla calls and capability bits.
  - ayla-iot-unofficial 1.5.2 (MIT, 2026-08, pinned by Home Assistant core
    `fujitsu_fglair`): the FGLair reference, **ported**; pyfujitseu (MIT, 2022) for the economy / powerful / outdoor low-noise property names.
  - HTTP is bare node:http / node:https: no runtime dependency beyond the SDK
    (image light for 256 MB), `npm audit` clean.
- **Airstage headers**: those of pyairstage (content type, iOS User-Agent,
  bearer), not the browser `sec-fetch-*` and `accept-encoding: gzip` of the
  plugin: the transport does not decompress, and Home Assistant users run
  pyairstage's headers.
- **One device per indoor unit**; an Airstage unit is `airstage:<mac>` (the
  cloud `deviceId` and the adapter `device_id` are the MAC, as
  homebridge-fujitsu-airstage pairs them), an FGLair unit `fglair:<dsn>`. An
  adapter of the list whose MAC is a unit of the Airstage account is the same
  device. Its readings come from ONE way at a time: the adapter while it
  answers and GLADYS_PREFER_LOCAL is on (the cloud then takes over, degraded
  badge), the cloud first when the toggle is off. Two failed adapter reads in
  a row before the switch; a down adapter is retried with a growing delay
  (30 s → 5 min).
- **Polls**: Airstage cloud 2 min (ha_airstage), adapters 30 s (ha_airstage
  polls every 10 s; gentler here), FGLair 5 min (Home Assistant core), plus
  an FGLair read 5 s after a command. The FGLair A/F modules get a `refresh`
  datapoint after each read, as Home Assistant does, for a fresh room
  temperature.
- **Commands**: Gladys waits 5 s, so a command never waits for the unit: the
  Airstage set request returns its id and its status is followed in the
  background (1.5 s × 8); the adapter answers at once; FGLair takes one
  datapoint per property. The commanded value is published at once (has
  feedback), with what the unit does on its own (homebridge-fujitsu-airstage:
  dry → fan auto; minimum heat → on, heat, fan auto, 10 °C; off when it
  stops), and kept as the reading of that way until the next poll.
- **Feature mapping**: modes and fan speeds on the Gladys enums; Airstage has
  no capability list, so its fan options are the 5 of the app (pyairstage),
  medium low / high added when a unit reports them. Gladys has 5 vertical
  positions: units with up to 5 have them in `swing-vertical`, units with 6
  or 8 get a `vertical-position` select ("1".."8"). Economy, powerful,
  outdoor low noise, energy saving fan and minimum heat are switches, present
  when the unit reports the parameter (Airstage, not "65535") or the
  capability bit and the property (FGLair). The error code is a read-only
  text (raw value).
- **Setpoint**: 16–30 °C in heat, 18–30 °C otherwise (pyairstage,
  ayla-iot-unofficial), half degrees; the feature minimum is 10 °C on units
  with minimum heat; refused in fan mode.
- **Sessions**: kept in /data with an HMAC of e-mail + password + region
  (keyed by the install id), never the password; a refused password is never
  retried automatically; the Airstage `deviceToken` is generated once per
  installation in the shape of the plugin's.
