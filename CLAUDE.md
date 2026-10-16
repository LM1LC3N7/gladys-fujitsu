# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency; HTTP is bare `node:http` / `node:https`. It turns the
Fujitsu air conditioners of three sources into Gladys AIR_CONDITIONING
devices: the **Airstage cloud** (account of the Airstage app), the **Airstage
Wi-Fi adapters** on the LAN (local API) and the **FGLair cloud** (Ayla
Networks, account of the FGLair app). Unofficial, not affiliated with Fujitsu
General.

The protocols are ported from MIT projects (homebridge-fujitsu-airstage,
pyairstage, ayla-iot-unofficial, pyfujitseu): keep the NOTICE up to date when
porting more.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit. Node only
runs in Docker on the author's machine: `~/bin/nrun gladys-fujitsu "<cmd>"`.

## Architecture

```
index.js              SDK bootstrap only
src/handlers.js       every SDK handler -> the app (shared with the tests)
src/app.js            FujitsuApp: sources, polls, unit entries, the way each unit
                      is reached (local / cloud), commands, status, badges, test
src/airstage.js       Airstage cloud client (sign-in, refresh, devices, set request, status)
src/airstageLocal.js  Airstage adapter client (GetParam / SetParam, pause, HTTPS fallback)
src/fglair.js         FGLair (Ayla) client (sign-in, refresh, devices, properties, datapoints)
src/units.js          Airstage parameters and FGLair properties <-> fields, supported
                      features, commands (pure)
src/devices.js        unit -> Gladys device, states, command -> change (pure)
src/http.js           node:http(s) transport, error kinds, Retry-After
src/publisher.js      states within the Gladys rate limit
src/storage.js        install id, Airstage device token, sessions, adapter schemes
src/config.js         config_schema normalized, the adapter list parsed
src/constants.js      manifest keys, hosts, feature keys, Gladys AC enums, timings
src/i18n.js           runtime texts (en/fr)
test/fixtures/        JSON answers shaped after the reference projects
test/helpers/         fake clouds (transports), fake adapter (loopback HTTP), timers
```

## Rules

- **External ids are forever**: device = `airstage:<MAC lowercased>` (the
  cloud device id and the adapter `device_id` are the MAC) or
  `fglair:<DSN lowercased>`, feature = `<device>:<key>` with the keys of
  `FEATURES` (constants.js). The select values `"1"`..`"8"` of
  `vertical-position` are frozen too: scenes store them.
- Manifest keys are frozen: `airstage_email`, `airstage_password`,
  `airstage_region`, `airstage_country`, `airstage_local_units`,
  `fglair_email`, `fglair_password`, `fglair_region`, `language`,
  `test_connection`.
- Value conventions: the Gladys side uses the core enums of
  `server/utils/constants.js` (AC_MODE, AC_FAN_SPEED, AC_SWING_*), copied in
  constants.js; units.js turns both Fujitsu models into the same fields
  (`mode: 'HEAT'`, `fan: 'MEDIUM'`…). Convert in devices.js only.
- **Never sign in more than needed**: the sessions are kept in /data, a
  refused password is never retried automatically; the test button is the only
  extra sign-in.
- An Airstage unit takes the readings of ONE way at a time (`sourceOf`):
  never mix the adapter and cloud values of a unit.
- The adapter is strict: header names with their case (`Content-Type`…),
  `iu_model` alone, at most 20 names per GetParam, a pause between requests.
- Gladys waits 5 s for a command: commands use `TIMINGS.commandTimeout` and
  never wait for the unit (the cloud request is followed in the background).
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (adapters by IP, no broadcast). Gladys: 300
  states/min (the publisher keeps 250).
- Never log or put in a status message a password, a token or a request
  header.
- Tests never touch the network beyond 127.0.0.1: fake clouds as transports,
  fake adapters on the loopback, SDK fake Gladys.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
