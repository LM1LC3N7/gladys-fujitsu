// -----------------------------------------------------------------------------
// The two data models (Airstage parameters, FGLair properties) turned into the
// same fields, what each unit supports, and the commands back.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UnsupportedError } from '../src/http.js';
import {
  AIRSTAGE_LOCAL_READ,
  airstageParams,
  airstageParamsOf,
  applyChange,
  checkSetpoint,
  emptyFields,
  fglairDatapoints,
  fglairModelType,
  fglairPropsOf,
  parseAirstage,
  parseFglair,
  supportedAirstage,
  supportedFglair,
} from '../src/units.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const AIRSTAGE = fixture('airstage-devices.json').devices;
const LOCAL = fixture('airstage-local.json');
const FGLAIR = fixture('fglair-properties.json');
const params = (i) => airstageParamsOf(AIRSTAGE[i].parameters);

test('Airstage parameters -> fields (cloud device list)', () => {
  const { fields, unknown } = parseAirstage(params(0));
  assert.deepEqual(unknown, []);
  assert.deepEqual(fields, {
    ...emptyFields(),
    power: 'ON',
    mode: 'HEAT',
    setpoint: 21.5,
    indoor: 22.5,
    outdoor: 8.5,
    fan: 'MEDIUM',
    swingVertical: false,
    verticalPosition: 2,
    swingHorizontal: true,
    economy: false,
    powerful: false,
    outdoorLowNoise: false,
    energySavingFan: false,
    minimumHeat: false,
    errorCode: '0',
  });
  const bedroom = parseAirstage(params(1)).fields;
  assert.equal(bedroom.power, 'OFF');
  assert.equal(bedroom.mode, 'COOL');
  assert.equal(bedroom.fan, 'AUTO');
  assert.equal(bedroom.outdoor, null, '65535: not available');
  assert.equal(bedroom.powerful, null);
  assert.equal(bedroom.swingVertical, true);
  assert.equal(bedroom.verticalPosition, 3);
});

test('Airstage parameters -> fields (adapter answer), unknown values reported', () => {
  const { fields } = parseAirstage(airstageParamsOf(LOCAL.state.value));
  assert.equal(fields.mode, 'COOL');
  assert.equal(fields.fan, 'LOW');
  assert.equal(fields.setpoint, 23);
  assert.equal(fields.indoor, 25.1);
  assert.equal(fields.outdoor, 31.2);
  assert.equal(fields.economy, true);
  const odd = parseAirstage({ iu_op_mode: '7', iu_fan_spd: '3', iu_set_tmp: '65535' });
  assert.deepEqual(odd.unknown, ['iu_op_mode=7', 'iu_fan_spd=3']);
  assert.equal(odd.fields.setpoint, null);
  assert.equal(parseAirstage({ iu_fan_spd: '7' }).fields.fan, 'MEDIUM_LOW');
  assert.equal(parseAirstage({ iu_fan_spd: '9' }).fields.fan, 'MEDIUM_HIGH');
  assert.equal(parseAirstage({ iu_indoor_tmp: 'x' }).fields.indoor, null);
});

test('what an Airstage unit supports', () => {
  assert.deepEqual(supportedAirstage(params(0)), {
    modes: ['AUTO', 'COOL', 'DRY', 'FAN', 'HEAT'],
    fans: ['AUTO', 'QUIET', 'LOW', 'MEDIUM', 'HIGH'],
    swingVertical: true,
    verticalPositions: 4,
    swingHorizontal: true,
    economy: true,
    powerful: true,
    outdoorLowNoise: true,
    energySavingFan: true,
    minimumHeat: true,
    indoor: true,
    outdoor: true,
    errorCode: true,
  });
  const bedroom = supportedAirstage(params(1));
  assert.equal(bedroom.verticalPositions, 8);
  assert.equal(bedroom.swingHorizontal, false);
  assert.equal(bedroom.powerful, false);
  assert.equal(bedroom.outdoor, false);
  assert.equal(supportedAirstage({ iu_af_dir_vrt: '1' }).verticalPositions, 4, 'homebridge: 1..4');
  assert.equal(supportedAirstage({}).verticalPositions, 0);
  assert.ok(supportedAirstage({ iu_fan_spd: '9' }).fans.includes('MEDIUM_HIGH'));
});

test('the adapter read list fits one GetParam, without iu_model', () => {
  assert.ok(AIRSTAGE_LOCAL_READ.length <= 20);
  assert.ok(!AIRSTAGE_LOCAL_READ.includes('iu_model'));
  assert.ok(!AIRSTAGE_LOCAL_READ.includes('iu_hmn_det'));
  assert.equal(new Set(AIRSTAGE_LOCAL_READ).size, AIRSTAGE_LOCAL_READ.length);
});

test('changes -> Airstage parameters (string values, like the app)', () => {
  const fields = parseAirstage(params(0)).fields;
  assert.deepEqual(airstageParams({ power: 'OFF' }, fields), { iu_onoff: '0' });
  assert.deepEqual(airstageParams({ mode: 'DRY' }, fields), { iu_op_mode: '2' });
  assert.deepEqual(airstageParams({ setpoint: 22.5 }, fields), { iu_set_tmp: '225' });
  assert.deepEqual(airstageParams({ fan: 'QUIET' }, fields), { iu_fan_spd: '2' });
  assert.deepEqual(airstageParams({ fan: 'HIGH' }, fields), { iu_fan_spd: '11' });
  assert.deepEqual(airstageParams({ swingVertical: true }, fields), { iu_af_swg_vrt: '1' });
  assert.deepEqual(airstageParams({ verticalPosition: 4 }, fields), { iu_af_dir_vrt: '4' });
  assert.deepEqual(
    airstageParams({ verticalPosition: 4 }, { ...fields, swingVertical: true }),
    { iu_af_swg_vrt: '0', iu_af_dir_vrt: '4' },
    'a position stops the swing',
  );
  assert.deepEqual(airstageParams({ swingHorizontal: false }, fields), { iu_af_swg_hrz: '0' });
  assert.deepEqual(airstageParams({ economy: true }, fields), { iu_economy: '1' });
  assert.deepEqual(airstageParams({ powerful: true }, fields), { iu_powerful: '1' });
  assert.deepEqual(airstageParams({ outdoorLowNoise: true }, fields), { ou_low_noise: '1' });
  assert.deepEqual(airstageParams({ energySavingFan: true }, fields), { iu_fan_ctrl: '1' });
  assert.deepEqual(airstageParams({ minimumHeat: true }, fields), { iu_min_heat: '1' });
  assert.throws(() => airstageParams({ indoor: 20 }, fields), UnsupportedError);
});

test('the setpoint: half degrees, within the range of the mode', () => {
  assert.equal(checkSetpoint(21.3, { mode: 'HEAT' }), 21.5);
  assert.equal(checkSetpoint('16', { mode: 'HEAT' }), 16);
  assert.equal(checkSetpoint(30, { mode: 'COOL' }), 30);
  assert.throws(() => checkSetpoint(17, { mode: 'COOL' }), /between 18 and 30/);
  assert.throws(() => checkSetpoint(15, { mode: 'HEAT' }), /between 16 and 30/);
  assert.throws(() => checkSetpoint(31, { mode: 'AUTO' }), /between 18 and 30/);
  assert.throws(() => checkSetpoint(22, { mode: 'FAN' }), /fan mode/);
  assert.throws(() => checkSetpoint('x', { mode: 'HEAT' }), UnsupportedError);
});

test('what the unit does on its own after a command', () => {
  const fields = { ...emptyFields(), power: 'ON', mode: 'COOL', fan: 'HIGH', setpoint: 24 };
  assert.equal(applyChange(fields, { mode: 'DRY' }).fan, 'AUTO');
  assert.deepEqual(applyChange(fields, { minimumHeat: true }), {
    ...fields,
    minimumHeat: true,
    power: 'ON',
    mode: 'HEAT',
    fan: 'AUTO',
    setpoint: 10,
  });
  assert.equal(applyChange(fields, { minimumHeat: false }).power, 'OFF');
  assert.equal(
    applyChange({ ...fields, swingVertical: true }, { verticalPosition: 2 }).swingVertical,
    false,
  );
  assert.equal(applyChange(fields, { setpoint: 22 }).setpoint, 22);
});

test('FGLair model types (oem_model of the Wi-Fi module)', () => {
  assert.equal(fglairModelType('AP-WA2E'), 'A');
  assert.equal(fglairModelType('AP-WD1E'), 'A');
  assert.equal(fglairModelType('AP-WB1E'), 'B');
  assert.equal(fglairModelType('AP-WF3E'), 'F');
  assert.equal(fglairModelType('RV1001AE'), null);
  assert.equal(fglairModelType(undefined), null);
});

test('FGLair properties -> fields', () => {
  const a = fglairPropsOf(FGLAIR.AC000W000000001);
  assert.equal(a.meta.operation_mode.name, 'operation_mode');
  assert.equal(a.meta.display_temperature.readOnly, true);
  const { fields, unknown } = parseFglair(a.props, 'A');
  assert.deepEqual(unknown, []);
  assert.deepEqual(fields, {
    ...emptyFields(),
    power: 'ON',
    mode: 'COOL',
    setpoint: 23,
    indoor: 22.5,
    outdoor: 8.5,
    fan: 'AUTO',
    swingVertical: true,
    swingHorizontal: false,
    economy: false,
    powerful: false,
    outdoorLowNoise: true,
  });
  const b = parseFglair(fglairPropsOf(FGLAIR.AC000W000000002).props, 'B').fields;
  assert.equal(b.power, 'OFF');
  assert.equal(b.mode, null, 'off: the mode is not known');
  assert.equal(b.indoor, null, 'B modules do not report the room temperature');
  assert.equal(b.outdoor, null);
  assert.equal(b.fan, 'MEDIUM');
  assert.equal(b.swingVertical, true, 'B modules: 3 means swinging');
  assert.equal(parseFglair({ operation_mode: 1 }, 'A').fields.power, 'ON');
  assert.deepEqual(parseFglair({ operation_mode: 9 }, 'A').unknown, ['operation_mode=9']);
  // The SET_ / GET_ prefixes of some property names are dropped, the full name kept.
  const prefixed = fglairPropsOf([{ property: { name: 'SET_fan_speed', value: 1 } }]);
  assert.equal(prefixed.props.fan_speed, 1);
  assert.equal(prefixed.meta.fan_speed.name, 'SET_fan_speed');
});

test('what an FGLair unit supports (capability bits and properties)', () => {
  const a = supportedFglair(fglairPropsOf(FGLAIR.AC000W000000001).props, 'A');
  assert.deepEqual(a, {
    modes: ['AUTO', 'COOL', 'DRY', 'FAN', 'HEAT'],
    fans: ['AUTO', 'QUIET', 'LOW', 'MEDIUM', 'HIGH'],
    swingVertical: true,
    verticalPositions: 0,
    swingHorizontal: true,
    energySavingFan: false,
    minimumHeat: false,
    indoor: true,
    outdoor: true,
    errorCode: false,
    economy: true,
    powerful: true,
    outdoorLowNoise: true,
  });
  const b = supportedFglair(fglairPropsOf(FGLAIR.AC000W000000002).props, 'B');
  assert.deepEqual(b.fans, ['AUTO', 'LOW', 'MEDIUM', 'HIGH']);
  assert.equal(b.swingVertical, true);
  assert.equal(b.swingHorizontal, false, 'no capability bit');
  assert.equal(b.economy, false);
  assert.equal(b.indoor, false);
  assert.equal(b.outdoor, false);
  // Cool-only unit.
  assert.deepEqual(supportedFglair({ device_capabilities: 1 | (1 << 5) }, 'A').modes, ['COOL']);
});

test('changes -> FGLair datapoints (integer values)', () => {
  assert.deepEqual(fglairDatapoints({ power: 'OFF' }, 'A', 'COOL'), [['operation_mode', 0]]);
  assert.deepEqual(fglairDatapoints({ power: 'ON' }, 'A', 'HEAT'), [['operation_mode', 6]]);
  assert.deepEqual(fglairDatapoints({ power: 'ON' }, 'A', null), [['operation_mode', 1]]);
  assert.deepEqual(fglairDatapoints({ mode: 'AUTO' }, 'A', null), [['operation_mode', 2]]);
  assert.deepEqual(fglairDatapoints({ mode: 'DRY' }, 'A', null), [['operation_mode', 4]]);
  assert.deepEqual(fglairDatapoints({ setpoint: 21.5 }, 'A'), [['adjust_temperature', 215]]);
  assert.deepEqual(fglairDatapoints({ fan: 'QUIET' }, 'A'), [['fan_speed', 0]]);
  assert.deepEqual(fglairDatapoints({ fan: 'AUTO' }, 'A'), [['fan_speed', 4]]);
  assert.deepEqual(fglairDatapoints({ swingVertical: true }, 'A'), [['af_vertical_swing', 1]]);
  assert.deepEqual(fglairDatapoints({ swingVertical: true }, 'B'), [['af_vertical_move_step1', 3]]);
  assert.deepEqual(fglairDatapoints({ swingHorizontal: false }, 'F'), [['af_horizontal_swing', 0]]);
  assert.deepEqual(fglairDatapoints({ economy: true }, 'A'), [['economy_mode', 1]]);
  assert.deepEqual(fglairDatapoints({ powerful: false }, 'A'), [['powerful_mode', 0]]);
  assert.deepEqual(fglairDatapoints({ outdoorLowNoise: true }, 'A'), [['outdoor_low_noise', 1]]);
  assert.throws(() => fglairDatapoints({ minimumHeat: true }, 'A'), UnsupportedError);
});
