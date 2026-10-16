# Test fixtures

Made-up answers of the Fujitsu services and adapters, shaped after the data of
the reference projects (no real account was used):

- `airstage-devices.json`: `GET /apiv1/devices/all` of the Airstage cloud. The
  shape (`devices[]` with `deviceId`, `deviceName`, `connectionStatus` and
  `parameters[]` of `{ name, value }`) is the one homebridge-fujitsu-airstage
  reads (`src/airstage/cloud/client.js`, `_getDevicesFromApi`, MIT) and the one
  pyairstage builds for an adapter (`airstageApi.py` `ApiLocal.get_devices`,
  with `modifiedAt`, MIT); the parameter names and value encodings are those
  of `src/airstage/constants.js` and `pyairstage/constants.py` ("65535" when
  the unit does not have the parameter, temperatures as `value / 10` and
  `(value - 5000) / 100`). The device id is the MAC address of the adapter,
  uppercase without separators, as homebridge-fujitsu-airstage pairs the
  cloud and LAN devices.
- `airstage-local.json`: `POST /GetParam` answers of an adapter (`result`
  "OK" and the `value` map, as in homebridge-fujitsu-airstage
  `test/airstage/lan/api/test-client.js`), and an "NG" answer.
- `fglair-devices.json`: `GET /apiv1/devices.json` of the FGLair cloud
  (Ayla Networks): `[{ device }]` with the fields ayla-iot-unofficial reads
  (`device.py`: `dsn`, `key`, `oem_model`, `model`, `mac`, `lan_ip`,
  `product_name`, `connection_status`, MIT) and the others of
  homebridge-fujitsu-hvac `src/api/models.ts` `Device` (MIT), plus one
  non-Fujitsu Ayla device that must be left out.
- `fglair-properties.json`: `GET /apiv1/dsns/<dsn>/properties.json`, by DSN:
  `[{ property }]` with the fields of homebridge-fujitsu-hvac `Property` and
  the property names of ayla-iot-unofficial `fujitsu_consts.py` and pyfujitseu
  `splitAC.py` (MIT). The capability masks are built from the bits of
  `fujitsu_consts.py` `Capability`.
