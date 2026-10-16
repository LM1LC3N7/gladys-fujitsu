# Fujitsu Airstage & FGLair (air conditioners)

Fujitsu air conditioners and air-to-air heat pumps with Wi-Fi are controlled
with one of two Fujitsu apps: **Airstage** (the current one, with the newer
units and Wi-Fi adapters) or **FGLair** (the older Wi-Fi modules, still common
in Europe). This integration brings the units of either app into Gladys: turn
them on and off, change the mode, the setpoint, the fan and the swing, use the
economy, powerful and outdoor low-noise modes, and follow the indoor and
outdoor temperatures. Airstage units can also be controlled **locally**,
through their Wi-Fi adapter, without the cloud.

**Unofficial**: not affiliated with Fujitsu General.

> **Development version (0.1).** Written from the projects that Homebridge and
> Home Assistant users run with these units (see Credits), and checked against
> their data; not yet tested with a real Fujitsu unit or account. Your
> feedback is welcome on the GitHub repository.

## Which units

| Your app                               | What to fill in                                                      | How Gladys reaches the unit                                       |
| -------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **FUJITSU AIRSTAGE** (Airstage Mobile) | the Airstage account, and/or the address of the unit's Wi-Fi adapter | the adapter on your network, or the Airstage cloud (Europe or US) |
| **FGLair**                             | the FGLair account                                                   | the FGLair cloud (Europe, or the other regions)                   |

- Both apps can be used at the same time: fill in both accounts.
- **Not covered**: Atlantic units of the **Cozytouch** app (use the Overkiz
  integration of the store), and Fujitsu units without Wi-Fi or on another
  controller (KNX, Modbus, Intesis…).

## What you get

One Gladys air conditioner per indoor unit, with the features the unit has
(Fujitsu says which: a unit without a setting gets no feature for it):

| Feature                     | In Gladys                                                               |
| --------------------------- | ----------------------------------------------------------------------- |
| On/off                      | air conditioner on/off                                                  |
| Mode                        | auto, cool, heat, dry, fan                                              |
| Setpoint                    | 16 to 30 °C in heat, 18 to 30 °C otherwise, half degrees                |
| Fan speed                   | auto, quiet, low, medium, high                                          |
| Vertical swing              | off, swing, and the fixed positions (up to 4)                           |
| Vertical position           | position 1 (top) to 6 or 8 (bottom), on the units with 6 or 8 positions |
| Horizontal swing            | off, swing                                                              |
| Economy, Powerful           | switches                                                                |
| Outdoor unit low noise      | switch                                                                  |
| Energy saving fan           | switch (Airstage)                                                       |
| Minimum heat (10 °C)        | switch (Airstage): heat at 10 °C to keep the room from freezing         |
| Indoor, outdoor temperature | temperature sensors (°C)                                                |
| Error code                  | text, read only (Airstage)                                              |

Like in the apps: dry mode sets the fan to auto, a fixed vertical position
stops the vertical swing, the minimum heat mode turns the unit on in heat at
10 °C (and off when it stops). With FGLair, choosing a mode also turns the
unit on, and turning it on goes back to its last mode.

## Installation

1. Check that your units work in the Airstage or FGLair app.
2. In the configuration of the integration, fill in what you use:
   - **Airstage app**: the e-mail and the password of the app, the region
     (Europe for an account created in Europe) and the country of the account,
     in English as chosen in the app (`France`, `Belgium`, `Switzerland`…).
   - **Airstage Wi-Fi adapters** (optional): one entry per unit, separated by
     commas: its IP address, its MAC address, and a name if you want, for
     example `192.168.1.20 E8:FB:1C:12:34:56 Living room, 192.168.1.21 E8:FB:1C:65:43:21`.
     Give each adapter a fixed IP address in your router. The MAC address is
     on the label of the adapter and in your router; for a unit already found
     through the Airstage cloud, it is also in the device page of Gladys.
     Adapters that answer in HTTPS are found on their own; write
     `https://192.168.1.20` to force it.
   - **FGLair app**: the e-mail and the password of the app, and the region
     (Europe, or the other regions).
3. Save, then click **Test the connection**: each account lists its units,
   each adapter answers with its model.
4. Open the **Discovery** tab and add your units.

## Options

| Option                          | Default | Purpose                                                                                                                    |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| Airstage region                 | Europe  | the Airstage cloud of the account (Europe, United States)                                                                  |
| Country of the Airstage account | France  | sent at sign-in, as the app does                                                                                           |
| FGLair region                   | Europe  | the FGLair cloud of the account (Europe, other regions)                                                                    |
| Language of the feature names   | French  | names of the features and of their options                                                                                 |
| Prefer the local connection     | on      | Gladys toggle: an Airstage unit with an adapter in the list goes through it, the cloud as a fallback; off: the cloud first |

## How it works

- **Airstage adapters**: Gladys reads each adapter on your network every
  30 seconds and sends the commands to it. The integration container runs on
  a bridge network, so the adapters are reached by their IP address (no
  automatic discovery).
- **Airstage cloud**: the units and all their settings are read every
  2 minutes; a command is sent as a request that the cloud passes to the unit,
  and Gladys follows it until the unit took it.
- **FGLair cloud**: the settings of each unit are read every 5 minutes, and a
  few seconds after a command. FGLair has a local mode too, but it needs the
  unit to call Gladys back, which the integration container cannot receive.
- The sign-ins are kept in the `/data` folder of the integration, so a
  restart of Gladys does not sign in again. The passwords are never written
  there. A refused password is never retried on its own: fix it and save.
- The transport badge of each unit shows **local** (through its adapter),
  **cloud**, or **unreachable**. An orange dot means the unit went through the
  other way because its usual way failed (adapter unreachable, cloud down).

## Troubleshooting

- **"the e-mail or the password was refused"**: check them in the app, and
  the region (an account created in Europe is on the Europe cloud), then save.
- **An adapter is unreachable**: check its IP address (fixed in your router),
  that Gladys and the unit are on the same network, and the MAC address: a
  wrong MAC makes the adapter answer "NG 0002".
- **Adapter entries not understood**: each entry needs an IP address (or a
  host name with a dot) and a MAC address.
- **The setpoint is refused**: 16 to 30 °C in heat, 18 to 30 °C in the other
  modes; it cannot be set in fan mode.
- **"too many requests"**: the cloud slows Gladys down; it tries again after
  the delay the cloud asks for, up to one hour.

## Credits

The Airstage cloud and adapter protocol comes from
[homebridge-fujitsu-airstage](https://github.com/PatrickStankard/homebridge-fujitsu-airstage)
by Patrick Stankard (MIT) and [pyairstage](https://github.com/danielkaldheim/pyairstage)
by Daniel Rufus Kaldheim (MIT), the library of the
[ha_airstage](https://github.com/danielkaldheim/ha_airstage) Home Assistant
integration. The FGLair protocol comes from
[ayla-iot-unofficial](https://github.com/rewardone/ayla-iot-unofficial) (MIT),
the library of the Home Assistant `fujitsu_fglair` integration, and
[pyfujitseu](https://github.com/Mmodarre/pyfujitsu) (MIT), cross-checked with
[homebridge-fujitsu-hvac](https://github.com/hycken/homebridge-fujitsu-hvac)
(MIT). See the NOTICE file of the repository.
