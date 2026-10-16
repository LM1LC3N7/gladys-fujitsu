// -----------------------------------------------------------------------------
// The two Fujitsu data models, turned into the same fields, and the commands
// back (pure).
//
// Airstage (cloud and Wi-Fi adapter share the parameter names): string values
// of `iu_*` parameters, "65535" when the unit does not have it. Ported from
// homebridge-fujitsu-airstage (Patrick Stankard, MIT, src/airstage/constants.js
// and the cloud/LAN clients) and pyairstage (Daniel Rufus Kaldheim, MIT,
// constants.py, airstageAC.py), the library of the ha_airstage integration.
//
// FGLair (Ayla Networks properties): integer values of named properties,
// what the unit supports in the `device_capabilities` bit mask. Ported from
// ayla-iot-unofficial (rewardone, MIT, fujitsu_consts.py, fujitsu_hvac.py),
// the library of the Home Assistant `fujitsu_fglair` integration, and
// pyfujitseu (Mmodarre, MIT, splitAC.py) for the economy, powerful and
// outdoor low-noise properties.
//
// Fields (null when unknown):
//   power 'ON' | 'OFF'; mode 'AUTO' | 'COOL' | 'DRY' | 'FAN' | 'HEAT';
//   setpoint, indoor, outdoor (°C); fan 'AUTO' | 'QUIET' | 'LOW' |
//   'MEDIUM_LOW' | 'MEDIUM' | 'MEDIUM_HIGH' | 'HIGH'; swingVertical,
//   swingHorizontal, economy, powerful, outdoorLowNoise, energySavingFan,
//   minimumHeat (booleans); verticalPosition (1..n); errorCode (text).
// A change is one field with its new value: { mode: 'HEAT' }…
// -----------------------------------------------------------------------------

import { SETPOINT } from './constants.js';
import { UnsupportedError } from './http.js';

export const MODES = ['AUTO', 'COOL', 'DRY', 'FAN', 'HEAT'];
export const FAN_SPEEDS = ['AUTO', 'QUIET', 'LOW', 'MEDIUM_LOW', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH'];

const invert = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
const round = (value, step) => Math.round(value / step) * step;
const round1 = (value) => Math.round(value * 10) / 10;

export function emptyFields() {
  return {
    power: null,
    mode: null,
    setpoint: null,
    indoor: null,
    outdoor: null,
    fan: null,
    swingVertical: null,
    verticalPosition: null,
    swingHorizontal: null,
    economy: null,
    powerful: null,
    outdoorLowNoise: null,
    energySavingFan: null,
    minimumHeat: null,
    errorCode: null,
  };
}

/** The setpoint bounds of a mode (°C). */
export const setpointRange = (mode) => [
  mode === 'HEAT' ? SETPOINT.heatMin : SETPOINT.coolMin,
  SETPOINT.max,
];

/** A setpoint as the unit takes it: half degrees, within the range of the mode. */
export function checkSetpoint(value, fields) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new UnsupportedError('the setpoint must be a number');
  }
  if (fields.mode === 'FAN') {
    throw new UnsupportedError('the setpoint cannot be set in fan mode');
  }
  const [min, max] = setpointRange(fields.mode);
  const celsius = round(n, SETPOINT.step);
  if (celsius < min || celsius > max) {
    throw new UnsupportedError(`the setpoint must be between ${min} and ${max} °C`);
  }
  return celsius;
}

/**
 * The fields once a command was taken, with what the unit does on its own
 * (homebridge-fujitsu-airstage updates its cache the same way): dry mode sets
 * the fan to auto; the minimum heat mode turns the unit on in heat at 10 °C,
 * and turns it off when it stops.
 */
export function applyChange(fields, change) {
  const next = { ...fields, ...change };
  if (change.mode === 'DRY') {
    next.fan = 'AUTO';
  }
  if ('verticalPosition' in change) {
    next.swingVertical = false;
  }
  if (change.minimumHeat === true) {
    Object.assign(next, { power: 'ON', mode: 'HEAT', fan: 'AUTO', setpoint: SETPOINT.minimumHeat });
  } else if (change.minimumHeat === false) {
    next.power = 'OFF';
  }
  return next;
}

// --- Airstage ----------------------------------------------------------------

export const NOT_AVAILABLE = '65535';

export const AIRSTAGE = {
  POWER: 'iu_onoff',
  MODE: 'iu_op_mode',
  FAN: 'iu_fan_spd',
  SETPOINT: 'iu_set_tmp',
  INDOOR: 'iu_indoor_tmp',
  OUTDOOR: 'iu_outdoor_tmp',
  VERTICAL_SWING: 'iu_af_swg_vrt',
  VERTICAL_DIRECTION: 'iu_af_dir_vrt',
  VERTICAL_POSITIONS: 'iu_af_inc_vrt',
  HORIZONTAL_SWING: 'iu_af_swg_hrz',
  ECONOMY: 'iu_economy',
  POWERFUL: 'iu_powerful',
  OUTDOOR_LOW_NOISE: 'ou_low_noise',
  ENERGY_SAVING_FAN: 'iu_fan_ctrl',
  MINIMUM_HEAT: 'iu_min_heat',
  ERROR: 'iu_err_code',
  MODEL: 'iu_model',
};

/** Field -> parameter of the boolean settings. */
const AIRSTAGE_TOGGLES = {
  economy: AIRSTAGE.ECONOMY,
  powerful: AIRSTAGE.POWERFUL,
  outdoorLowNoise: AIRSTAGE.OUTDOOR_LOW_NOISE,
  energySavingFan: AIRSTAGE.ENERGY_SAVING_FAN,
  minimumHeat: AIRSTAGE.MINIMUM_HEAT,
};

/**
 * What an adapter is asked for at every poll: at most 20 names per request
 * (pyairstage), without `iu_model` (homebridge-fujitsu-airstage: it truncates
 * the answer, so it is read alone, once) nor `iu_hmn_det` / `iu_pow_cons`
 * (pyairstage: they cannot be read together).
 */
export const AIRSTAGE_LOCAL_READ = [
  AIRSTAGE.POWER,
  AIRSTAGE.MODE,
  AIRSTAGE.FAN,
  AIRSTAGE.SETPOINT,
  AIRSTAGE.INDOOR,
  AIRSTAGE.OUTDOOR,
  AIRSTAGE.VERTICAL_SWING,
  AIRSTAGE.VERTICAL_DIRECTION,
  AIRSTAGE.VERTICAL_POSITIONS,
  AIRSTAGE.HORIZONTAL_SWING,
  AIRSTAGE.ECONOMY,
  AIRSTAGE.POWERFUL,
  AIRSTAGE.OUTDOOR_LOW_NOISE,
  AIRSTAGE.ENERGY_SAVING_FAN,
  AIRSTAGE.MINIMUM_HEAT,
  AIRSTAGE.ERROR,
];

const AIRSTAGE_MODES = { 0: 'AUTO', 1: 'COOL', 2: 'DRY', 3: 'FAN', 4: 'HEAT' };
const AIRSTAGE_FANS = {
  0: 'AUTO',
  2: 'QUIET',
  5: 'LOW',
  7: 'MEDIUM_LOW',
  8: 'MEDIUM',
  9: 'MEDIUM_HIGH',
  11: 'HIGH',
};
const AIRSTAGE_MODE_CODE = invert(AIRSTAGE_MODES);
const AIRSTAGE_FAN_CODE = invert(AIRSTAGE_FANS);
/** The fan speeds of the Airstage app (pyairstage FanSpeed, ha_airstage). */
const AIRSTAGE_APP_FANS = ['AUTO', 'QUIET', 'LOW', 'MEDIUM', 'HIGH'];

const availableValue = (v) =>
  v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== NOT_AVAILABLE;
const intOf = (v) => (availableValue(v) && /^-?\d+$/.test(String(v).trim()) ? Number(v) : null);
const toggleOf = (v) => {
  const n = intOf(v);
  return n === 1 ? true : n === 0 ? false : null;
};

/** Airstage temperatures: (value - 5000) / 100 °C (pyairstage, homebridge-fujitsu-airstage). */
function airstageSensed(value) {
  const n = intOf(value);
  if (n === null) {
    return null;
  }
  const celsius = round1((n - 5000) / 100);
  return celsius >= -50 && celsius <= 80 ? celsius : null;
}

/** The Airstage parameters of a device list or of an adapter answer, as a name -> value map. */
export function airstageParamsOf(list) {
  if (Array.isArray(list)) {
    return Object.fromEntries(
      list
        .filter((p) => p && typeof p.name === 'string')
        .map((p) => [p.name, p.value === undefined || p.value === null ? '' : String(p.value)]),
    );
  }
  if (list && typeof list === 'object') {
    return Object.fromEntries(
      Object.entries(list).map(([k, v]) => [k, v === undefined || v === null ? '' : String(v)]),
    );
  }
  return {};
}

/** Airstage parameters -> fields; `unknown` lists the values not understood. */
export function parseAirstage(params) {
  const fields = emptyFields();
  const unknown = [];
  const power = toggleOf(params[AIRSTAGE.POWER]);
  fields.power = power === null ? null : power ? 'ON' : 'OFF';
  const mode = intOf(params[AIRSTAGE.MODE]);
  if (mode !== null) {
    fields.mode = AIRSTAGE_MODES[mode] ?? null;
    if (!fields.mode) {
      unknown.push(`${AIRSTAGE.MODE}=${mode}`);
    }
  }
  const fan = intOf(params[AIRSTAGE.FAN]);
  if (fan !== null) {
    fields.fan = AIRSTAGE_FANS[fan] ?? null;
    if (!fields.fan) {
      unknown.push(`${AIRSTAGE.FAN}=${fan}`);
    }
  }
  const setpoint = intOf(params[AIRSTAGE.SETPOINT]);
  if (setpoint !== null && setpoint / 10 >= 5 && setpoint / 10 <= 40) {
    fields.setpoint = setpoint / 10;
  }
  fields.indoor = airstageSensed(params[AIRSTAGE.INDOOR]);
  fields.outdoor = airstageSensed(params[AIRSTAGE.OUTDOOR]);
  fields.swingVertical = toggleOf(params[AIRSTAGE.VERTICAL_SWING]);
  const direction = intOf(params[AIRSTAGE.VERTICAL_DIRECTION]);
  fields.verticalPosition =
    direction !== null && direction >= 1 && direction <= 8 ? direction : null;
  fields.swingHorizontal = toggleOf(params[AIRSTAGE.HORIZONTAL_SWING]);
  for (const [field, name] of Object.entries(AIRSTAGE_TOGGLES)) {
    fields[field] = toggleOf(params[name]);
  }
  if (availableValue(params[AIRSTAGE.ERROR])) {
    fields.errorCode = String(params[AIRSTAGE.ERROR]).trim().slice(0, 40);
  }
  return { fields, unknown };
}

/**
 * What an Airstage unit supports: the parameters it reports with a value
 * (not "65535"). The vertical positions are counted by `iu_af_inc_vrt`
 * (pyairstage: 4, 6 or 8), 4 when only the direction is reported
 * (homebridge-fujitsu-airstage).
 */
export function supportedAirstage(params) {
  const has = (name) => availableValue(params[name]);
  const fan = AIRSTAGE_FANS[intOf(params[AIRSTAGE.FAN])];
  const count = intOf(params[AIRSTAGE.VERTICAL_POSITIONS]);
  return {
    modes: [...MODES],
    fans: FAN_SPEEDS.filter((f) => AIRSTAGE_APP_FANS.includes(f) || f === fan),
    swingVertical: has(AIRSTAGE.VERTICAL_SWING),
    verticalPositions: has(AIRSTAGE.VERTICAL_DIRECTION)
      ? count !== null && count >= 2 && count <= 8
        ? count
        : 4
      : 0,
    swingHorizontal: has(AIRSTAGE.HORIZONTAL_SWING),
    economy: has(AIRSTAGE.ECONOMY),
    powerful: has(AIRSTAGE.POWERFUL),
    outdoorLowNoise: has(AIRSTAGE.OUTDOOR_LOW_NOISE),
    energySavingFan: has(AIRSTAGE.ENERGY_SAVING_FAN),
    minimumHeat: has(AIRSTAGE.MINIMUM_HEAT),
    indoor: has(AIRSTAGE.INDOOR),
    outdoor: has(AIRSTAGE.OUTDOOR),
    errorCode: has(AIRSTAGE.ERROR),
  };
}

/** A change -> the Airstage parameters to set (string values, like the app). */
export function airstageParams(change, fields) {
  const [[field, value]] = Object.entries(change);
  const bit = (on) => (on ? '1' : '0');
  switch (field) {
    case 'power':
      return { [AIRSTAGE.POWER]: bit(value === 'ON') };
    case 'mode':
      return { [AIRSTAGE.MODE]: AIRSTAGE_MODE_CODE[value] };
    case 'setpoint':
      return { [AIRSTAGE.SETPOINT]: String(Math.round(value * 10)) };
    case 'fan':
      return { [AIRSTAGE.FAN]: AIRSTAGE_FAN_CODE[value] };
    case 'swingVertical':
      return { [AIRSTAGE.VERTICAL_SWING]: bit(value) };
    case 'verticalPosition':
      // A position stops the swing: both in one request when it swings.
      return fields.swingVertical === false
        ? { [AIRSTAGE.VERTICAL_DIRECTION]: String(value) }
        : { [AIRSTAGE.VERTICAL_SWING]: '0', [AIRSTAGE.VERTICAL_DIRECTION]: String(value) };
    case 'swingHorizontal':
      return { [AIRSTAGE.HORIZONTAL_SWING]: bit(value) };
    default:
      if (field in AIRSTAGE_TOGGLES) {
        return { [AIRSTAGE_TOGGLES[field]]: bit(value) };
      }
      throw new UnsupportedError(`${field} cannot be controlled`);
  }
}

// --- FGLair ------------------------------------------------------------------

export const FGLAIR = {
  OPERATION_MODE: 'operation_mode',
  SETPOINT: 'adjust_temperature',
  DISPLAY_TEMPERATURE: 'display_temperature',
  OUTDOOR_TEMPERATURE: 'outdoor_temperature',
  FAN: 'fan_speed',
  CAPABILITIES: 'device_capabilities',
  NAME: 'device_name',
  REFRESH: 'refresh',
  ECONOMY: 'economy_mode',
  POWERFUL: 'powerful_mode',
  OUTDOOR_LOW_NOISE: 'outdoor_low_noise',
};

/** The oem_model of the FGLair Wi-Fi modules, by model type (ayla-iot-unofficial DEVICE_MAP). */
export const FGLAIR_MODELS = {
  A: [
    'AP-WA1E',
    'AP-WA2E',
    'AP-WA3E',
    'AP-WA4E',
    'AP-WA5E',
    'AP-WA6E',
    'AP-WC1E',
    'AP-WC2E',
    'AP-WC3E',
    'AP-WC4E',
    'AP-WD1E',
  ],
  B: ['AP-WB1E', 'AP-WB2E', 'AP-WB3E', 'AP-WB4E'],
  F: ['AP-WF1E', 'AP-WF2E', 'AP-WF3E', 'AP-WF4E'],
};

/** Model type of an oem_model, or null for a device that is not a Fujitsu air conditioner. */
export function fglairModelType(oemModel) {
  for (const [type, models] of Object.entries(FGLAIR_MODELS)) {
    if (models.includes(oemModel)) {
      return type;
    }
  }
  return null;
}

/** The swing properties and their "on" value, per model type (ayla-iot-unofficial). */
const FGLAIR_SWING = {
  A: { vertical: 'af_vertical_swing', horizontal: 'af_horizontal_swing', on: 1 },
  B: { vertical: 'af_vertical_move_step1', horizontal: 'af_horizontal_move_step1', on: 3 },
  F: { vertical: 'af_vertical_swing', horizontal: 'af_horizontal_swing', on: 1 },
};
/** Only the A and F modules report the room temperature (SENSED_TEMP_SUPPORTED). */
const FGLAIR_SENSED = { A: true, B: false, F: true };

/** device_capabilities bits (ayla-iot-unofficial Capability, homebridge-fujitsu-hvac). */
export const CAPABILITY = {
  COOL: 1,
  DRY: 1 << 1,
  FAN: 1 << 2,
  HEAT: 1 << 3,
  AUTO: 1 << 4,
  FAN_AUTO: 1 << 5,
  FAN_HIGH: 1 << 6,
  FAN_MEDIUM: 1 << 7,
  FAN_LOW: 1 << 8,
  FAN_QUIET: 1 << 9,
  SWING_VERTICAL: 1 << 10,
  SWING_HORIZONTAL: 1 << 11,
  ECONOMY: 1 << 12,
  MINIMUM_HEAT: 1 << 13,
  ENERGY_SWING_FAN: 1 << 14,
  POWERFUL: 1 << 16,
  OUTDOOR_LOW_NOISE: 1 << 17,
  COIL_DRY: 1 << 18,
};

/** operation_mode: 0 off, 1 on (last mode), then the modes. */
const FGLAIR_MODES = { 2: 'AUTO', 3: 'COOL', 4: 'DRY', 5: 'FAN', 6: 'HEAT' };
const FGLAIR_FANS = { 0: 'QUIET', 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH', 4: 'AUTO' };
const FGLAIR_MODE_CODE = invert(FGLAIR_MODES);
const FGLAIR_FAN_CODE = invert(FGLAIR_FANS);
const FGLAIR_TOGGLES = {
  economy: { name: FGLAIR.ECONOMY, capability: CAPABILITY.ECONOMY },
  powerful: { name: FGLAIR.POWERFUL, capability: CAPABILITY.POWERFUL },
  outdoorLowNoise: { name: FGLAIR.OUTDOOR_LOW_NOISE, capability: CAPABILITY.OUTDOOR_LOW_NOISE },
};

/**
 * FGLair temperatures: 4000..9500 maps linearly to -10..45 °C, rounded to the
 * half degree (ayla-iot-unofficial _convert_sensed_temp_to_celsius).
 */
function fglairSensed(value) {
  const n = intOf(value);
  if (n === null || n < 4000 || n > 9500) {
    return null;
  }
  return round(-10 + ((n - 4000) / 5500) * 55, 0.5);
}

/** The Ayla properties of a unit, as a name -> value map (prefixes SET_/GET_ dropped). */
export function fglairPropsOf(list) {
  const props = {};
  const meta = {};
  for (const entry of Array.isArray(list) ? list : []) {
    const p = entry?.property;
    if (!p || typeof p.name !== 'string') {
      continue;
    }
    const name = /^(set_|get_)/i.test(p.name) ? p.name.slice(4) : p.name;
    props[name] = p.value;
    meta[name] = { name: p.name, readOnly: p.read_only === true };
  }
  return { props, meta };
}

export function parseFglair(props, modelType) {
  const fields = emptyFields();
  const unknown = [];
  const op = intOf(props[FGLAIR.OPERATION_MODE]);
  if (op === 0) {
    fields.power = 'OFF';
  } else if (op === 1) {
    fields.power = 'ON';
  } else if (op !== null) {
    fields.mode = FGLAIR_MODES[op] ?? null;
    if (fields.mode) {
      fields.power = 'ON';
    } else {
      unknown.push(`${FGLAIR.OPERATION_MODE}=${op}`);
    }
  }
  const setpoint = intOf(props[FGLAIR.SETPOINT]);
  if (setpoint !== null && setpoint / 10 >= 5 && setpoint / 10 <= 40) {
    fields.setpoint = setpoint / 10;
  }
  if (FGLAIR_SENSED[modelType]) {
    fields.indoor = fglairSensed(props[FGLAIR.DISPLAY_TEMPERATURE]);
  }
  fields.outdoor = fglairSensed(props[FGLAIR.OUTDOOR_TEMPERATURE]);
  const fan = intOf(props[FGLAIR.FAN]);
  if (fan !== null) {
    fields.fan = FGLAIR_FANS[fan] ?? null;
    if (!fields.fan) {
      unknown.push(`${FGLAIR.FAN}=${fan}`);
    }
  }
  const swing = FGLAIR_SWING[modelType];
  if (swing) {
    for (const [field, name] of [
      ['swingVertical', swing.vertical],
      ['swingHorizontal', swing.horizontal],
    ]) {
      const n = intOf(props[name]);
      fields[field] = n === null ? null : n === swing.on;
    }
  }
  for (const [field, { name }] of Object.entries(FGLAIR_TOGGLES)) {
    fields[field] = toggleOf(props[name]);
  }
  return { fields, unknown };
}

/**
 * What an FGLair unit supports, from its capability bits; a setting also
 * needs its property in the list (the bits are the indoor unit's, the
 * properties the Wi-Fi module's).
 */
export function supportedFglair(props, modelType) {
  const caps = intOf(props[FGLAIR.CAPABILITIES]);
  const can = (bit) => caps === null || (caps & bit) === bit;
  const has = (name) => name in props;
  const swing = FGLAIR_SWING[modelType];
  const modes = MODES.filter((m) => can(CAPABILITY[m]));
  const fans = ['AUTO', 'QUIET', 'LOW', 'MEDIUM', 'HIGH'].filter((f) =>
    can(CAPABILITY[`FAN_${f}`]),
  );
  const supported = {
    modes: modes.length > 0 ? modes : [...MODES],
    fans: fans.length > 0 ? fans : ['AUTO'],
    swingVertical: Boolean(swing) && can(CAPABILITY.SWING_VERTICAL) && has(swing.vertical),
    verticalPositions: 0,
    swingHorizontal: Boolean(swing) && can(CAPABILITY.SWING_HORIZONTAL) && has(swing.horizontal),
    energySavingFan: false,
    minimumHeat: false,
    indoor: Boolean(FGLAIR_SENSED[modelType]) && has(FGLAIR.DISPLAY_TEMPERATURE),
    outdoor: fglairSensed(props[FGLAIR.OUTDOOR_TEMPERATURE]) !== null,
    errorCode: false,
  };
  for (const [field, { name, capability }] of Object.entries(FGLAIR_TOGGLES)) {
    supported[field] = can(capability) && has(name);
  }
  return supported;
}

/**
 * A change -> the FGLair datapoints to post, [property, integer value]. The
 * operation mode carries the power: a mode turns the unit on, "on" restores
 * the last mode (`lastMode`, else the code 1 the unit understands as "on").
 */
export function fglairDatapoints(change, modelType, lastMode) {
  const [[field, value]] = Object.entries(change);
  const swing = FGLAIR_SWING[modelType];
  switch (field) {
    case 'power':
      return [
        [FGLAIR.OPERATION_MODE, value === 'ON' ? Number(FGLAIR_MODE_CODE[lastMode] ?? 1) : 0],
      ];
    case 'mode':
      return [[FGLAIR.OPERATION_MODE, Number(FGLAIR_MODE_CODE[value])]];
    case 'setpoint':
      return [[FGLAIR.SETPOINT, Math.round(value * 10)]];
    case 'fan':
      return [[FGLAIR.FAN, Number(FGLAIR_FAN_CODE[value])]];
    case 'swingVertical':
      return [[swing.vertical, value ? swing.on : 0]];
    case 'swingHorizontal':
      return [[swing.horizontal, value ? swing.on : 0]];
    default:
      if (field in FGLAIR_TOGGLES) {
        return [[FGLAIR_TOGGLES[field].name, value ? 1 : 0]];
      }
      throw new UnsupportedError(`${field} cannot be controlled`);
  }
}
