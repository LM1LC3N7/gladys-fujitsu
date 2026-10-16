# gladys-fujitsu

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Fujitsu air conditioners and air-to-air heat pumps of the Airstage and
FGLair apps**. It reads the units of an Airstage account (Europe or US cloud),
talks directly to the Airstage Wi-Fi adapters on the LAN when their address is
given (preferred, with the cloud as a fallback), and reads the units of an
FGLair account (Ayla Networks cloud, Europe or the other regions). Each indoor
unit becomes one Gladys air conditioner. **Unofficial, not affiliated with
Fujitsu General.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (0.1, not published to the store yet).** Written from the
> reference projects below and checked against their data; not yet tested
> with a real Fujitsu unit or account.

Not for the Atlantic units of the Cozytouch app: they are covered by the
Overkiz integration of the store (cicoub13/gladys-overkiz).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (FujitsuApp)
                                  ├─ src/airstage.js       Airstage cloud: sign-in, refresh, device list,
                                  │                        set_parameters_request + its status (node:https)
                                  ├─ src/airstageLocal.js  Airstage Wi-Fi adapter: GetParam / SetParam
                                  │                        on the LAN (node:http, HTTPS fallback)
                                  ├─ src/fglair.js         FGLair (Ayla) cloud: sign-in, refresh, devices,
                                  │                        properties, datapoints (node:https)
                                  ├─ src/units.js          Airstage parameters / FGLair properties <-> fields,
                                  │                        supported features, commands (pure)
                                  ├─ src/devices.js        unit -> Gladys AIR_CONDITIONING device (pure)
                                  ├─ src/publisher.js      states within 300/min
                                  └─ src/storage.js        tokens and ids in /data
```

- **Airstage cloud** (`bke.euro.airstagelight.com` / `bke.us.airstagelight.com`):
  `POST /apiv1/users/sign_in` with the e-mail, password and country of the
  app, the tokens kept in `/data` and refreshed; `GET /apiv1/devices/all`
  every 2 minutes gives every unit with all its `iu_*` parameters; a command
  is a `set_parameters_request` whose status is then followed.
- **Airstage Wi-Fi adapters**: `POST http://<ip>/GetParam` every 30 seconds
  and `POST /SetParam` for the commands, the MAC address of the adapter as
  `device_id`. The header names keep their case (the adapter refuses
  lowercase ones), `iu_model` is read alone, at most 20 names per request,
  a pause between two requests; HTTPS (self-signed) when HTTP is refused.
  An adapter whose MAC is a unit of the Airstage account is the same Gladys
  device, reached locally while the adapter answers and the "Prefer the local
  connection" toggle is on.
- **FGLair cloud** (`user-field-eu` / `ads-eu.aylanetworks.com`, or the
  default region): sign-in with the application id of the FGLair app,
  `GET /apiv1/devices.json` and `/dsns/<dsn>/properties.json` every 5 minutes,
  a datapoint per command. The FGLair LAN mode needs an inbound connection
  from the unit, impossible from the container: cloud only.
- **Safety**: a refused password is never retried on its own; HTTP 429 waits
  what Retry-After says (up to one hour); passwords and tokens are never
  logged.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against fake Airstage and FGLair clouds (transports of the
clients), fake Wi-Fi adapters on the loopback (real HTTP, strict about the
header case like the real ones) and the SDK's fake Gladys. The JSON fixtures
are shaped after the data of the reference projects
([test/fixtures](test/fixtures/README.md)).

## Credits

- [homebridge-fujitsu-airstage](https://github.com/PatrickStankard/homebridge-fujitsu-airstage)
  by Patrick Stankard (MIT, 4.0.0): the Airstage cloud and LAN API (paths,
  bodies, parameter names and encodings, error codes), ported.
- [pyairstage](https://github.com/danielkaldheim/pyairstage) by Daniel Rufus
  Kaldheim (MIT, 3.2.2), the library of
  [ha_airstage](https://github.com/danielkaldheim/ha_airstage): the extra
  parameters (outdoor temperature, swing positions, low noise, error code),
  the adapter limits and HTTPS, ported.
- [ayla-iot-unofficial](https://github.com/rewardone/ayla-iot-unofficial)
  (MIT, 1.5.2), the library of the Home Assistant `fujitsu_fglair`
  integration: the FGLair hosts, application ids, properties, capability bits
  and model types, ported.
- [pyfujitseu](https://github.com/Mmodarre/pyfujitsu) (MIT): the economy,
  powerful and outdoor low-noise properties.
- Cross-checked with [homebridge-fujitsu-hvac](https://github.com/hycken/homebridge-fujitsu-hvac)
  (MIT) and the [fglair](https://www.npmjs.com/package/fglair) npm client (ISC).

None of them is a dependency (see [TODO.md](TODO.md), Decisions); their
licence notices are in [NOTICE](NOTICE).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0.
