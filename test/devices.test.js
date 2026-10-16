// -----------------------------------------------------------------------------
// Unit -> Gladys device, its states, and the commands its features take.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  AC_FAN_SPEED,
  AC_MODE,
  AC_SWING_HORIZONTAL,
  AC_SWING_VERTICAL,
  DEVICE_TYPES,
} from '../src/constants.js';
import { buildDevice, changeOf, idsOf, statesOf, unitId } from '../src/devices.js';
import { UnsupportedError } from '../src/http.js';
import {
  airstageParamsOf,
  fglairPropsOf,
  parseAirstage,
  parseFglair,
  supportedAirstage,
  supportedFglair,
} from '../src/units.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const AIRSTAGE = fixture('airstage-devices.json').devices;
const FGLAIR = fixture('fglair-properties.json');
const gladys = createFakeGladys();

function airstageEntry(i) {
  const params = airstageParamsOf(AIRSTAGE[i].parameters);
  const id = AIRSTAGE[i].deviceId;
  return {
    entry: {
      kind: DEVICE_TYPES.AIRSTAGE,
      id,
      name: AIRSTAGE[i].deviceName,
      model: params.iu_model,
      supported: supportedAirstage(params),
      ids: idsOf(gladys, DEVICE_TYPES.AIRSTAGE, id),
    },
    fields: parseAirstage(params).fields,
  };
}

function fglairEntry(dsn, modelType) {
  const { props } = fglairPropsOf(FGLAIR[dsn]);
  return {
    entry: {
      kind: DEVICE_TYPES.FGLAIR,
      id: dsn,
      name: props.device_name,
      model: 'AP-WA2E',
      modelType,
      supported: supportedFglair(props, modelType),
      ids: idsOf(gladys, DEVICE_TYPES.FGLAIR, dsn),
    },
    fields: parseFglair(props, modelType).fields,
  };
}

const keysOf = (device) => device.features.map((f) => f.external_id.split(':').pop());
const featureOf = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
const statesMap = (entry, fields) => Object.fromEntries(statesOf(entry, fields));

test('external ids: MAC or DSN, lowercase', () => {
  assert.equal(unitId('E8FB1C123456'), 'e8fb1c123456');
  assert.equal(unitId('AC000W000000001'), 'ac000w000000001');
  assert.equal(unitId(' a b '), 'a-b');
  assert.equal(unitId(''), 'unknown');
  const { entry } = airstageEntry(0);
  assert.equal(entry.ids.device, 'ext:test-integration:airstage:e8fb1c123456');
});

test('an Airstage unit with everything (4 vertical positions)', () => {
  const { entry } = airstageEntry(0);
  const device = buildDevice(entry, 'fr');
  assert.equal(device.name, 'Salon');
  assert.equal(device.model, 'fujitsu-airstage');
  assert.deepEqual(device.params, [
    { name: 'MAC_ADDRESS', value: 'E8:FB:1C:12:34:56' },
    { name: 'MODEL', value: 'ASYG09KMTB' },
  ]);
  assert.deepEqual(keysOf(device), [
    'binary',
    'mode',
    'target-temperature',
    'fan-speed',
    'swing-vertical',
    'swing-horizontal',
    'economy',
    'powerful',
    'outdoor-low-noise',
    'energy-saving-fan',
    'minimum-heat',
    'indoor-temperature',
    'outdoor-temperature',
    'error-code',
  ]);
  const mode = featureOf(device, 'mode');
  assert.deepEqual(
    mode.supported_options.map((o) => [o.value, o.label]),
    [
      [AC_MODE.AUTO, 'Auto'],
      [AC_MODE.COOLING, 'Froid'],
      [AC_MODE.HEATING, 'Chaud'],
      [AC_MODE.DRYING, 'Déshumidification'],
      [AC_MODE.FAN, 'Ventilation'],
    ],
  );
  assert.deepEqual(
    featureOf(device, 'fan-speed').supported_options.map((o) => o.value),
    [AC_FAN_SPEED.AUTO, AC_FAN_SPEED.QUIET, AC_FAN_SPEED.LOW, AC_FAN_SPEED.MID, AC_FAN_SPEED.HIGH],
  );
  const swing = featureOf(device, 'swing-vertical');
  assert.deepEqual(
    swing.supported_options.map((o) => o.value),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(swing.supported_options[2].label, 'Position 1 (haut)');
  assert.equal(swing.supported_options[5].label, 'Position 4 (bas)');
  assert.equal(swing.max, AC_SWING_VERTICAL.POSITION_4);
  const setpoint = featureOf(device, 'target-temperature');
  assert.deepEqual([setpoint.min, setpoint.max, setpoint.unit], [10, 30, 'celsius']);
  assert.equal(featureOf(device, 'error-code').read_only, true);
  assert.equal(featureOf(device, 'error-code').category, 'text');
  assert.equal(featureOf(device, 'economy').category, 'switch');
  assert.equal(featureOf(device, 'indoor-temperature').type, 'decimal');
  assert.equal(buildDevice(entry, 'en').features[0].name, 'On/off');
});

test('an Airstage unit with 8 positions: the positions go to a select', () => {
  const { entry } = airstageEntry(1);
  const device = buildDevice(entry, 'en');
  const keys = keysOf(device);
  assert.ok(keys.includes('vertical-position'));
  assert.ok(!keys.includes('swing-horizontal'));
  assert.ok(!keys.includes('powerful'));
  assert.ok(!keys.includes('outdoor-temperature'));
  assert.deepEqual(
    featureOf(device, 'swing-vertical').supported_options.map((o) => o.value),
    [AC_SWING_VERTICAL.OFF, AC_SWING_VERTICAL.SWING],
  );
  const select = featureOf(device, 'vertical-position');
  assert.deepEqual([select.category, select.type], ['text', 'select']);
  assert.deepEqual(
    select.supported_options.map((o) => o.value),
    ['1', '2', '3', '4', '5', '6', '7', '8'],
  );
  assert.equal(select.supported_options[7].label, 'Position 8 (bottom)');
  assert.equal(featureOf(device, 'target-temperature').min, 16);
});

test('the states of an Airstage unit', () => {
  const { entry, fields } = airstageEntry(0);
  assert.deepEqual(statesMap(entry, fields), {
    binary: { state: 1 },
    mode: { state: AC_MODE.HEATING },
    'target-temperature': { state: 21.5 },
    'fan-speed': { state: AC_FAN_SPEED.MID },
    'swing-vertical': { state: AC_SWING_VERTICAL.POSITION_2 },
    'swing-horizontal': { state: AC_SWING_HORIZONTAL.SWING },
    economy: { state: 0 },
    powerful: { state: 0 },
    'outdoor-low-noise': { state: 0 },
    'energy-saving-fan': { state: 0 },
    'minimum-heat': { state: 0 },
    'indoor-temperature': { state: 22.5 },
    'outdoor-temperature': { state: 8.5 },
    'error-code': { text: '0' },
  });
  const swinging = statesMap(entry, { ...fields, swingVertical: true });
  assert.deepEqual(swinging['swing-vertical'], { state: AC_SWING_VERTICAL.SWING });
  const bedroom = airstageEntry(1);
  const states = statesMap(bedroom.entry, bedroom.fields);
  assert.deepEqual(states['swing-vertical'], { state: AC_SWING_VERTICAL.SWING });
  assert.deepEqual(states['vertical-position'], { text: '3' });
  assert.equal(states['outdoor-temperature'], undefined);
  const stopped = statesMap(bedroom.entry, { ...bedroom.fields, swingVertical: false });
  assert.deepEqual(stopped['swing-vertical'], { state: AC_SWING_VERTICAL.OFF });
});

test('an FGLair unit (A module) and its states', () => {
  const { entry, fields } = fglairEntry('AC000W000000001', 'A');
  const device = buildDevice(entry, 'en');
  assert.equal(device.model, 'fujitsu-fglair');
  assert.deepEqual(device.params, [
    { name: 'DSN', value: 'AC000W000000001' },
    { name: 'MODEL', value: 'AP-WA2E' },
  ]);
  assert.deepEqual(keysOf(device), [
    'binary',
    'mode',
    'target-temperature',
    'fan-speed',
    'swing-vertical',
    'swing-horizontal',
    'economy',
    'powerful',
    'outdoor-low-noise',
    'indoor-temperature',
    'outdoor-temperature',
  ]);
  assert.deepEqual(statesMap(entry, fields), {
    binary: { state: 1 },
    mode: { state: AC_MODE.COOLING },
    'target-temperature': { state: 23 },
    'fan-speed': { state: AC_FAN_SPEED.AUTO },
    'swing-vertical': { state: AC_SWING_VERTICAL.SWING },
    'swing-horizontal': { state: AC_SWING_HORIZONTAL.OFF },
    economy: { state: 0 },
    powerful: { state: 0 },
    'outdoor-low-noise': { state: 1 },
    'indoor-temperature': { state: 22.5 },
    'outdoor-temperature': { state: 8.5 },
  });
});

test('an FGLair unit (B module): no room temperature, no quiet speed', () => {
  const { entry, fields } = fglairEntry('AC000W000000002', 'B');
  const device = buildDevice(entry, 'en');
  assert.deepEqual(keysOf(device), [
    'binary',
    'mode',
    'target-temperature',
    'fan-speed',
    'swing-vertical',
  ]);
  const states = statesMap(entry, fields);
  assert.deepEqual(states.binary, { state: 0 });
  assert.equal(states.mode, undefined, 'unknown while off');
});

test('commands -> changes', () => {
  const { entry, fields } = airstageEntry(0);
  assert.deepEqual(changeOf(entry, 'binary', 0, fields), { power: 'OFF' });
  assert.deepEqual(changeOf(entry, 'binary', 1, fields), { power: 'ON' });
  assert.deepEqual(changeOf(entry, 'mode', AC_MODE.DRYING, fields), { mode: 'DRY' });
  assert.deepEqual(changeOf(entry, 'target-temperature', 20.2, fields), { setpoint: 20 });
  assert.deepEqual(changeOf(entry, 'fan-speed', AC_FAN_SPEED.QUIET, fields), { fan: 'QUIET' });
  assert.deepEqual(changeOf(entry, 'swing-vertical', AC_SWING_VERTICAL.SWING, fields), {
    swingVertical: true,
  });
  assert.deepEqual(changeOf(entry, 'swing-vertical', AC_SWING_VERTICAL.POSITION_3, fields), {
    verticalPosition: 3,
  });
  assert.deepEqual(changeOf(entry, 'swing-horizontal', AC_SWING_HORIZONTAL.OFF, fields), {
    swingHorizontal: false,
  });
  assert.deepEqual(changeOf(entry, 'economy', 1, fields), { economy: true });
  assert.deepEqual(changeOf(entry, 'minimum-heat', 0, fields), { minimumHeat: false });
  const bedroom = airstageEntry(1);
  assert.deepEqual(changeOf(bedroom.entry, 'vertical-position', '7', bedroom.fields), {
    verticalPosition: 7,
  });
});

test('commands the unit cannot take are refused with a message', () => {
  const { entry, fields } = airstageEntry(0);
  const refused = (key, value, pattern, f = fields, e = entry) =>
    assert.throws(
      () => changeOf(e, key, value, f),
      (err) => err instanceof UnsupportedError && pattern.test(err.message),
    );
  refused('swing-vertical', AC_SWING_VERTICAL.POSITION_5, /unknown vertical swing/);
  refused('fan-speed', AC_FAN_SPEED.TURBO, /no fan speed/);
  refused('fan-speed', AC_FAN_SPEED.LOW_MID, /no fan speed Medium low/);
  refused('target-temperature', 12, /between 16 and 30/);
  refused('target-temperature', 22, /fan mode/, { ...fields, mode: 'FAN' });
  refused('vertical-position', '2', /unknown vertical position/);
  refused('indoor-temperature', 20, /cannot be controlled/);
  refused('error-code', 'x', /cannot be controlled/);
  const bedroom = airstageEntry(1);
  refused('powerful', 1, /no Powerful setting/, bedroom.fields, bedroom.entry);
  refused('swing-horizontal', 1, /no horizontal swing/, bedroom.fields, bedroom.entry);
  refused('vertical-position', '9', /unknown vertical position/, bedroom.fields, bedroom.entry);
  const cool = { ...entry, supported: { ...entry.supported, modes: ['COOL'] } };
  refused('mode', AC_MODE.HEATING, /no Heat mode/, fields, cool);
});
