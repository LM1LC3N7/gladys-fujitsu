// -----------------------------------------------------------------------------
// The Gladys device of a Fujitsu unit, its states, and the commands its
// features take (pure).
//
// One AIR_CONDITIONING device per indoor unit, with the features the unit
// supports (units.js supportedAirstage / supportedFglair):
//   - `binary`              air-conditioning/binary: on/off;
//   - `mode`                air-conditioning/mode: AC_MODE (auto, cool, dry,
//                           fan, heat), the unit's modes as supported_options;
//   - `target-temperature`  air-conditioning/target-temperature (°C, half
//                           degrees; heat 16–30, the other modes 18–30);
//   - `fan-speed`           air-conditioning/fan-speed: AC_FAN_SPEED (auto,
//                           quiet, low, medium, high; medium low/high when
//                           the unit reports them);
//   - `swing-vertical`      air-conditioning/swing-vertical: off, swing, and
//                           the fixed positions on units with up to 5;
//   - `vertical-position`   text/select "1".."n": the positions of units with
//                           6 or 8 (Gladys has 5 vertical positions);
//   - `swing-horizontal`    air-conditioning/swing-horizontal: off / swing;
//   - `economy`, `powerful`, `outdoor-low-noise`, `energy-saving-fan`,
//     `minimum-heat`        switch/binary, when the unit has them;
//   - `indoor-temperature`, `outdoor-temperature`
//                           temperature-sensor/decimal (°C);
//   - `error-code`          text/text, read only (Airstage).
// The Gladys enums (server/utils/constants.js) are copied in constants.js.
// Feature external ids end with the keys of constants.js FEATURES: never
// rename one; the option values of the select ("1".."8") are frozen too.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  AC_FAN_SPEED,
  AC_MODE,
  AC_SWING_HORIZONTAL,
  AC_SWING_VERTICAL,
  DEVICE_TYPES,
  FEATURES,
  SETPOINT,
} from './constants.js';
import { UnsupportedError } from './http.js';
import { texts } from './i18n.js';
import { checkSetpoint } from './units.js';

/** Fujitsu mode -> Gladys AC_MODE, in the order of the options. */
const MODES = {
  AUTO: AC_MODE.AUTO,
  COOL: AC_MODE.COOLING,
  HEAT: AC_MODE.HEATING,
  DRY: AC_MODE.DRYING,
  FAN: AC_MODE.FAN,
};

/** Fujitsu fan speed -> Gladys AC_FAN_SPEED, from the slowest. */
const FAN_SPEEDS = {
  AUTO: AC_FAN_SPEED.AUTO,
  QUIET: AC_FAN_SPEED.QUIET,
  LOW: AC_FAN_SPEED.LOW,
  MEDIUM_LOW: AC_FAN_SPEED.LOW_MID,
  MEDIUM: AC_FAN_SPEED.MID,
  MEDIUM_HIGH: AC_FAN_SPEED.MID_HIGH,
  HIGH: AC_FAN_SPEED.HIGH,
};

/** The fixed positions Gladys has on swing-vertical. */
const GLADYS_POSITIONS = [
  AC_SWING_VERTICAL.POSITION_1,
  AC_SWING_VERTICAL.POSITION_2,
  AC_SWING_VERTICAL.POSITION_3,
  AC_SWING_VERTICAL.POSITION_4,
  AC_SWING_VERTICAL.POSITION_5,
];

/** The boolean settings: feature key -> field. */
const SWITCHES = {
  [FEATURES.ECONOMY]: 'economy',
  [FEATURES.POWERFUL]: 'powerful',
  [FEATURES.OUTDOOR_LOW_NOISE]: 'outdoorLowNoise',
  [FEATURES.ENERGY_SAVING_FAN]: 'energySavingFan',
  [FEATURES.MINIMUM_HEAT]: 'minimumHeat',
};

const invert = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [String(v), k]));
const MODE_OF = invert(MODES);
const FAN_OF = invert(FAN_SPEEDS);

/** Positions on swing-vertical (up to 5) or on the vertical-position select (6 and 8). */
const positionsOnSwing = (supported) =>
  supported.verticalPositions > 0 && supported.verticalPositions <= GLADYS_POSITIONS.length;
const positionsOnSelect = (supported) => supported.verticalPositions > GLADYS_POSITIONS.length;
const hasVertical = (supported) => supported.swingVertical || positionsOnSwing(supported);

/** The id of a unit in the external ids: its MAC (Airstage) or DSN (FGLair), [a-z0-9_-]. */
export function unitId(id) {
  const clean = String(id ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  return clean || 'unknown';
}

export const idsOf = (gladys, kind, id) => gladys.externalIds(kind, unitId(id));

const command = (feature) => ({
  read_only: false,
  has_feedback: true,
  keep_history: true,
  ...feature,
});
const sensor = (feature) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...feature,
});

/**
 * @param {{ kind: string, id: string, name: string, model: string | null,
 *   supported: object, ids: object }} entry
 * @param {'en' | 'fr'} language
 */
export function buildDevice(entry, language) {
  const { supported, ids } = entry;
  const t = texts(language);
  const named = (key, feature) => ({
    name: t.features[key],
    external_id: ids.feature(key),
    ...feature,
  });
  const sorted = (options) => options.map((o, i) => ({ ...o, sort_order: i }));
  const count = supported.verticalPositions;
  const positionLabel = (k) => t.options.position(k, count);

  const features = [
    named(
      FEATURES.POWER,
      command({ category: C.AIR_CONDITIONING, type: T.AIR_CONDITIONING.BINARY, min: 0, max: 1 }),
    ),
    named(
      FEATURES.MODE,
      command({
        category: C.AIR_CONDITIONING,
        type: T.AIR_CONDITIONING.MODE,
        min: AC_MODE.AUTO,
        max: AC_MODE.FAN,
        supported_options: sorted(
          Object.keys(MODES)
            .filter((m) => supported.modes.includes(m))
            .map((m) => ({ value: MODES[m], label: t.options.mode[m] })),
        ),
      }),
    ),
    named(
      FEATURES.SETPOINT,
      command({
        category: C.AIR_CONDITIONING,
        type: T.AIR_CONDITIONING.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        min: supported.minimumHeat ? SETPOINT.minimumHeat : SETPOINT.heatMin,
        max: SETPOINT.max,
      }),
    ),
    named(
      FEATURES.FAN,
      command({
        category: C.AIR_CONDITIONING,
        type: T.AIR_CONDITIONING.FAN_SPEED,
        min: AC_FAN_SPEED.AUTO,
        max: AC_FAN_SPEED.QUIET,
        supported_options: sorted(
          Object.keys(FAN_SPEEDS)
            .filter((f) => supported.fans.includes(f))
            .map((f) => ({ value: FAN_SPEEDS[f], label: t.options.fan[f] })),
        ),
      }),
    ),
  ];
  if (hasVertical(supported)) {
    const options = [];
    if (supported.swingVertical) {
      options.push(
        { value: AC_SWING_VERTICAL.OFF, label: t.options.swing.OFF },
        { value: AC_SWING_VERTICAL.SWING, label: t.options.swing.SWING },
      );
    }
    if (positionsOnSwing(supported)) {
      for (let k = 1; k <= count; k += 1) {
        options.push({ value: GLADYS_POSITIONS[k - 1], label: positionLabel(k) });
      }
    }
    features.push(
      named(
        FEATURES.SWING_VERTICAL,
        command({
          category: C.AIR_CONDITIONING,
          type: T.AIR_CONDITIONING.SWING_VERTICAL,
          min: AC_SWING_VERTICAL.OFF,
          max: positionsOnSwing(supported) ? GLADYS_POSITIONS[count - 1] : AC_SWING_VERTICAL.SWING,
          supported_options: sorted(options),
        }),
      ),
    );
  }
  if (positionsOnSelect(supported)) {
    const options = [];
    for (let k = 1; k <= count; k += 1) {
      options.push({ value: String(k), label: positionLabel(k) });
    }
    features.push(
      named(
        FEATURES.VERTICAL_POSITION,
        command({
          category: C.TEXT,
          type: T.TEXT.SELECT,
          keep_history: false,
          supported_options: sorted(options),
        }),
      ),
    );
  }
  if (supported.swingHorizontal) {
    features.push(
      named(
        FEATURES.SWING_HORIZONTAL,
        command({
          category: C.AIR_CONDITIONING,
          type: T.AIR_CONDITIONING.SWING_HORIZONTAL,
          min: AC_SWING_HORIZONTAL.OFF,
          max: AC_SWING_HORIZONTAL.SWING,
          supported_options: sorted([
            { value: AC_SWING_HORIZONTAL.OFF, label: t.options.swing.OFF },
            { value: AC_SWING_HORIZONTAL.SWING, label: t.options.swing.SWING },
          ]),
        }),
      ),
    );
  }
  for (const [key, field] of Object.entries(SWITCHES)) {
    if (supported[field]) {
      features.push(
        named(key, command({ category: C.SWITCH, type: T.SWITCH.BINARY, min: 0, max: 1 })),
      );
    }
  }
  const temperature = (key) =>
    named(
      key,
      sensor({
        category: C.TEMPERATURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.CELSIUS,
        min: -50,
        max: 80,
      }),
    );
  if (supported.indoor) {
    features.push(temperature(FEATURES.INDOOR));
  }
  if (supported.outdoor) {
    features.push(temperature(FEATURES.OUTDOOR));
  }
  if (supported.errorCode) {
    features.push(
      named(FEATURES.ERROR, sensor({ category: C.TEXT, type: T.TEXT.TEXT, keep_history: false })),
    );
  }
  const params =
    entry.kind === DEVICE_TYPES.AIRSTAGE
      ? [{ name: 'MAC_ADDRESS', value: entry.id.replace(/(..)(?!$)/g, '$1:') }]
      : [{ name: 'DSN', value: entry.id }];
  if (entry.model) {
    params.push({ name: 'MODEL', value: String(entry.model).slice(0, 60) });
  }
  return {
    name: entry.name,
    external_id: ids.device,
    model: entry.kind === DEVICE_TYPES.AIRSTAGE ? 'fujitsu-airstage' : 'fujitsu-fglair',
    params,
    features,
  };
}

/**
 * The states of a unit, from its fields (units.js), as [featureKey,
 * { state } | { text }] pairs. Fields without a value are left out.
 */
export function statesOf(entry, fields) {
  const { supported } = entry;
  const states = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined) {
      states.push([key, value]);
    }
  };
  const flag = (value) => (value === null || value === undefined ? null : { state: value ? 1 : 0 });
  add(FEATURES.POWER, fields.power === null ? null : { state: fields.power === 'ON' ? 1 : 0 });
  add(FEATURES.MODE, fields.mode in MODES ? { state: MODES[fields.mode] } : null);
  add(FEATURES.SETPOINT, fields.setpoint === null ? null : { state: fields.setpoint });
  add(
    FEATURES.FAN,
    fields.fan in FAN_SPEEDS && supported.fans.includes(fields.fan)
      ? { state: FAN_SPEEDS[fields.fan] }
      : null,
  );
  if (hasVertical(supported)) {
    const position =
      positionsOnSwing(supported) &&
      fields.verticalPosition >= 1 &&
      fields.verticalPosition <= supported.verticalPositions
        ? GLADYS_POSITIONS[fields.verticalPosition - 1]
        : null;
    if (fields.swingVertical === true && supported.swingVertical) {
      add(FEATURES.SWING_VERTICAL, { state: AC_SWING_VERTICAL.SWING });
    } else if (fields.swingVertical !== true && position !== null) {
      add(FEATURES.SWING_VERTICAL, { state: position });
    } else if (fields.swingVertical === false && supported.swingVertical) {
      add(FEATURES.SWING_VERTICAL, { state: AC_SWING_VERTICAL.OFF });
    }
  }
  if (
    positionsOnSelect(supported) &&
    fields.verticalPosition >= 1 &&
    fields.verticalPosition <= supported.verticalPositions
  ) {
    add(FEATURES.VERTICAL_POSITION, { text: String(fields.verticalPosition) });
  }
  if (supported.swingHorizontal) {
    add(
      FEATURES.SWING_HORIZONTAL,
      fields.swingHorizontal === null
        ? null
        : { state: fields.swingHorizontal ? AC_SWING_HORIZONTAL.SWING : AC_SWING_HORIZONTAL.OFF },
    );
  }
  for (const [key, field] of Object.entries(SWITCHES)) {
    if (supported[field]) {
      add(key, flag(fields[field]));
    }
  }
  if (supported.indoor) {
    add(FEATURES.INDOOR, fields.indoor === null ? null : { state: fields.indoor });
  }
  if (supported.outdoor) {
    add(FEATURES.OUTDOOR, fields.outdoor === null ? null : { state: fields.outdoor });
  }
  if (supported.errorCode && fields.errorCode !== null) {
    add(FEATURES.ERROR, { text: fields.errorCode });
  }
  return states;
}

const fail = (message) => {
  throw new UnsupportedError(message);
};

/**
 * The change a Gladys command asks for ({ mode: 'HEAT' }, { setpoint: 21.5 }…),
 * checked against what the unit supports. Throws UnsupportedError with a
 * message for the user (in English, like every command error).
 * @param {{ supported: object }} entry
 * @param {object} fields the current fields of the unit
 */
export function changeOf(entry, key, value, fields) {
  const { supported } = entry;
  const t = texts('en');
  const n = Number(value);
  switch (key) {
    case FEATURES.POWER:
      return { power: n === 0 ? 'OFF' : 'ON' };
    case FEATURES.MODE: {
      const mode = MODE_OF[String(n)];
      if (!mode || !supported.modes.includes(mode)) {
        fail(`this unit has no ${t.options.mode[mode] ?? value} mode`);
      }
      return { mode };
    }
    case FEATURES.SETPOINT:
      return { setpoint: checkSetpoint(value, fields) };
    case FEATURES.FAN: {
      const fan = FAN_OF[String(n)];
      if (!fan || !supported.fans.includes(fan)) {
        fail(`this unit has no fan speed ${t.options.fan[fan] ?? value}`);
      }
      return { fan };
    }
    case FEATURES.SWING_VERTICAL: {
      if (n === AC_SWING_VERTICAL.SWING || n === AC_SWING_VERTICAL.OFF) {
        if (!supported.swingVertical) {
          fail('this unit has no vertical swing');
        }
        return { swingVertical: n === AC_SWING_VERTICAL.SWING };
      }
      const position = GLADYS_POSITIONS.indexOf(n) + 1;
      if (position < 1 || !positionsOnSwing(supported) || position > supported.verticalPositions) {
        fail(`unknown vertical swing value ${value}`);
      }
      return { verticalPosition: position };
    }
    case FEATURES.VERTICAL_POSITION: {
      const position = Number(String(value ?? '').trim());
      if (
        !positionsOnSelect(supported) ||
        !Number.isInteger(position) ||
        position < 1 ||
        position > supported.verticalPositions
      ) {
        fail(`unknown vertical position ${value}`);
      }
      return { verticalPosition: position };
    }
    case FEATURES.SWING_HORIZONTAL:
      if (!supported.swingHorizontal) {
        fail('this unit has no horizontal swing');
      }
      if (n !== AC_SWING_HORIZONTAL.OFF && n !== AC_SWING_HORIZONTAL.SWING) {
        fail(`unknown horizontal swing value ${value}`);
      }
      return { swingHorizontal: n === AC_SWING_HORIZONTAL.SWING };
    default: {
      const field = SWITCHES[key];
      if (field) {
        if (!supported[field]) {
          fail(`this unit has no ${t.features[key]} setting`);
        }
        return { [field]: n !== 0 };
      }
      return fail(`${key} cannot be controlled`);
    }
  }
}
