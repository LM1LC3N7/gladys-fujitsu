// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration and scenes), the Fujitsu services and the tuning of the
// integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/**
 * The Airstage cloud (bke.<region>.airstagelight.com/apiv1), by region, as in
 * homebridge-fujitsu-airstage (src/airstage/cloud/apiv1/constants.js) and
 * pyairstage (the EU host).
 */
export const AIRSTAGE_HOSTS = {
  eu: 'bke.euro.airstagelight.com',
  us: 'bke.us.airstagelight.com',
};

/**
 * The FGLair cloud (Ayla Networks), by region, as in ayla-iot-unofficial
 * (const.py, fujitsu_consts.py FGLAIR_APP_CREDENTIALS), the library of the
 * Home Assistant `fujitsu_fglair` integration. The application id and secret
 * are the ones of the FGLair app, public in those projects.
 */
export const FGLAIR_REGIONS = {
  eu: {
    user: 'https://user-field-eu.aylanetworks.com',
    ads: 'https://ads-eu.aylanetworks.com',
    appId: 'FGLair-eu-id',
    appSecret: 'FGLair-eu-gpFbVBRoiJ8E3QWJ-QRULLL3j3U',
  },
  default: {
    user: 'https://user-field.aylanetworks.com',
    ads: 'https://ads-field.aylanetworks.com',
    appId: 'CJIOSP-id',
    appSecret: 'CJIOSP-Vb8MQL_lFiYQ7DKjN0eCFXznKZE',
  },
};

/** Device types of the external ids: ext:<selector>:airstage:<mac>, …:fglair:<dsn>. */
export const DEVICE_TYPES = {
  AIRSTAGE: 'airstage',
  FGLAIR: 'fglair',
};

/** Feature keys, the end of the feature external ids: never rename one. */
export const FEATURES = {
  POWER: 'binary',
  MODE: 'mode',
  SETPOINT: 'target-temperature',
  FAN: 'fan-speed',
  SWING_VERTICAL: 'swing-vertical',
  VERTICAL_POSITION: 'vertical-position',
  SWING_HORIZONTAL: 'swing-horizontal',
  ECONOMY: 'economy',
  POWERFUL: 'powerful',
  OUTDOOR_LOW_NOISE: 'outdoor-low-noise',
  ENERGY_SAVING_FAN: 'energy-saving-fan',
  MINIMUM_HEAT: 'minimum-heat',
  INDOOR: 'indoor-temperature',
  OUTDOOR: 'outdoor-temperature',
  ERROR: 'error-code',
};

/** Gladys core values (server/utils/constants.js, the SDK does not export them). */
export const AC_MODE = { AUTO: 0, COOLING: 1, HEATING: 2, DRYING: 3, FAN: 4 };
export const AC_FAN_SPEED = {
  AUTO: 0,
  LOW: 1,
  LOW_MID: 2,
  MID: 3,
  MID_HIGH: 4,
  HIGH: 5,
  QUIET: 6,
  TURBO: 7,
};
export const AC_SWING_VERTICAL = {
  OFF: 0,
  SWING: 1,
  POSITION_1: 2,
  POSITION_2: 3,
  POSITION_3: 4,
  POSITION_4: 5,
  POSITION_5: 6,
};
export const AC_SWING_HORIZONTAL = { OFF: 0, SWING: 1 };

/**
 * Setpoint bounds (°C): heat 16–30, the other modes 18–30 (pyairstage
 * ACConstants, ayla-iot-unofficial MIN_TEMP_*), half degrees; the minimum
 * heat mode holds 10 °C.
 */
export const SETPOINT = { heatMin: 16, coolMin: 18, max: 30, minimumHeat: 10, step: 0.5 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin. */
  statesPerMinute: 250,
  /** Size of an answer of a Fujitsu service or adapter (bytes). */
  responseBytes: 2 * 1024 * 1024,
  /** Units handled for one account. */
  units: 50,
  /** Adapters of the local list. */
  localUnits: 20,
};

export const TIMINGS = {
  /** One HTTP request to a cloud or an adapter while polling (Home Assistant: 20 s for an adapter). */
  httpTimeout: 20_000,
  /** One HTTP request of a command: Gladys waits 5 s for the answer of a command. */
  commandTimeout: 4500,
  /** Airstage cloud device list (ha_airstage: 120 s). */
  airstagePoll: 2 * 60_000,
  /** FGLair cloud properties (Home Assistant fujitsu_fglair: 5 min). */
  fglairPoll: 5 * 60_000,
  /** Airstage Wi-Fi adapters on the LAN (ha_airstage: 10 s; gentler here). */
  localPoll: 30_000,
  /** Pause between two requests to the same adapter (pyairstage: back-to-back requests get dropped). */
  localGap: 1000,
  /** Failed local reads in a row before an adapter counts as down. */
  localFailures: 2,
  /** A cloud command: its request status is read this often, this many times. */
  requestStatusInterval: 1500,
  requestStatusTries: 8,
  /** After a command, the unit is read again this late (FGLair, adapters). */
  afterCommand: 5000,
  /** A token is renewed this long before it expires. */
  tokenMargin: 10 * 60_000,
  /** Retry delays of an unreachable service (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 5 * 60_000,
  /** HTTP 429: wait longer each time (×3), or what Retry-After says. */
  rateLimitMin: 5 * 60_000,
  rateLimitMax: 60 * 60_000,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
};
