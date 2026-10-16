// -----------------------------------------------------------------------------
// The integration: up to three sources of Fujitsu units, their units as
// Gladys devices, the polls, the commands, the transport badges and the
// status shown in Gladys. index.js only wires the SDK handlers to it
// (src/handlers.js).
//
//   Airstage cloud ── device list every 2 min ──┐
//   Airstage Wi-Fi adapters ── GetParam / 30 s ─┼─► one entry per indoor unit
//   FGLair cloud ── properties every 5 min ─────┘   (Airstage cloud and adapter
//                                                     of the same MAC = one unit)
// An Airstage unit reached both ways follows the "Prefer the local connection"
// toggle (GLADYS_PREFER_LOCAL): the preferred way drives its states and
// commands while it works, the other one takes over (degraded badge) when it
// fails. A refused password is never retried on its own.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { AirstageCloud } from './airstage.js';
import { AirstageLocal, addressOf } from './airstageLocal.js';
import { normalizeConfig } from './config.js';
import { DEVICE_TYPES, TIMINGS } from './constants.js';
import { buildDevice, changeOf, idsOf, statesOf } from './devices.js';
import { FglairCloud } from './fglair.js';
import { FujitsuAuthError, FujitsuRateLimited, UnsupportedError } from './http.js';
import { T, join, texts } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { Storage } from './storage.js';
import {
  FGLAIR,
  airstageParams,
  applyChange,
  emptyFields,
  fglairDatapoints,
  parseAirstage,
  parseFglair,
  supportedAirstage,
  supportedFglair,
} from './units.js';

/** A short reason for a status message: never a token, a password or a header. */
const reasonOf = (err) => String(err?.message ?? err ?? 'error').slice(0, 120);

/** Union of what two readings say a unit supports. */
function mergeSupported(a, b) {
  if (!a) {
    return b;
  }
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x) || Array.isArray(y)) {
      out[key] = [...(x ?? []), ...(y ?? []).filter((v) => !(x ?? []).includes(v))];
    } else if (typeof x === 'number' || typeof y === 'number') {
      out[key] = Math.max(x ?? 0, y ?? 0);
    } else {
      out[key] = Boolean(x) || Boolean(y);
    }
  }
  return out;
}

/** The new reading over the kept one: a value the unit did not give keeps the last one. */
const mergeFields = (kept, read) =>
  Object.fromEntries(Object.entries(read).map(([k, v]) => [k, v === null ? kept[k] : v]));

const newSource = () => ({ status: 'idle', error: null, wait: 0, backoff: 0, rate: 0, count: 0 });

export class FujitsuApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'fujitsu' }),
    storage,
    createAirstage = (options) => new AirstageCloud(options),
    createLocal = (options) => new AirstageLocal(options),
    createFglair = (options) => new FglairCloud(options),
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.storage = storage ?? new Storage({ logger });
    this.createAirstage = createAirstage;
    this.createLocal = createLocal;
    this.createFglair = createFglair;
    this.now = now;
    this.timers = timers;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.configKey = undefined;
    this.rawConfig = {};
    this.generation = 0;
    this.started = false;
    this.scheduled = new Map();
    this.running = new Map();
    this.reset();
  }

  reset() {
    this.airstage = null;
    this.fglair = null;
    this.sources = { airstage: newSource(), fglair: newSource() };
    /** adapter id -> { unit, client, ok, failures, error, params, backoff, retryAt } */
    this.locals = new Map();
    /** `${kind}:${id}` -> entry */
    this.units = new Map();
    /** feature external id -> { entry, key } */
    this.routes = new Map();
    /** device external id -> transport entry last published (JSON) */
    this.transports = new Map();
    this.published = undefined;
    this.lastStatus = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * @param {object} raw the configuration
   * @param {{ force?: boolean }} options force: start again even with the same
   * configuration (the user saved it), instead of a resync
   */
  async start(raw = {}, { force = false } = {}) {
    const config = normalizeConfig(raw);
    const key = JSON.stringify(config);
    if (!force && key === this.configKey && this.started) {
      // Gladys reconnected, same configuration: resend what Gladys may have lost.
      await this.resync();
      return;
    }
    this.stop();
    this.config = config;
    this.configKey = key;
    this.rawConfig = raw;
    if (config.missing.length > 0) {
      await this.setStatus(false, join([...this.configNotes(), T.notConfigured]));
      return;
    }
    await this.setStatus(false, T.connecting);
    const generation = this.generation;
    const deviceToken = await this.storage.deviceToken();
    const airstageSession = config.airstage
      ? await this.storage.session('airstage', config.airstage)
      : null;
    const fglairSession = config.fglair
      ? await this.storage.session('fglair', config.fglair)
      : null;
    const schemes = await Promise.all(config.local.map((u) => this.storage.localScheme(u.id)));
    if (generation !== this.generation) {
      return;
    }
    this.started = true;
    if (config.airstage) {
      this.airstage = this.newAirstage(deviceToken, airstageSession);
    }
    if (config.fglair) {
      this.fglair = this.newFglair(fglairSession);
    }
    config.local.forEach((unit, i) => {
      this.locals.set(unit.id, {
        unit,
        client: this.createLocal({
          unit,
          scheme: schemes[i],
          onScheme: (scheme) =>
            this.storage
              .setLocalScheme(unit.id, scheme)
              .catch((err) =>
                this.logger.warn(`Keeping the adapter scheme failed: ${err.message}`),
              ),
          now: this.now,
        }),
        ok: null,
        failures: 0,
        error: null,
        params: null,
        backoff: 0,
        retryAt: 0,
      });
    });
    this.publisher.start();
    await this.pollAll(generation);
  }

  newAirstage(deviceToken, session = null) {
    const account = this.config.airstage;
    return this.createAirstage({
      account,
      deviceToken,
      session,
      onSession: (s) =>
        this.storage
          .setSession('airstage', account, s)
          .catch((err) => this.logger.warn(`Keeping the Airstage session failed: ${err.message}`)),
      logger: this.logger,
      now: this.now,
    });
  }

  newFglair(session = null) {
    const account = this.config.fglair;
    return this.createFglair({
      account,
      session,
      onSession: (s) =>
        this.storage
          .setSession('fglair', account, s)
          .catch((err) => this.logger.warn(`Keeping the FGLair session failed: ${err.message}`)),
      logger: this.logger,
      now: this.now,
    });
  }

  stop() {
    this.generation += 1;
    this.started = false;
    for (const timer of this.scheduled.values()) {
      this.timers.clearTimeout(timer);
    }
    this.scheduled.clear();
    this.running.clear();
    this.publisher.stop();
    this.publisher.clear();
    this.configKey = undefined;
    this.reset();
  }

  /** Runs `fn` after `delay`, once per name, unless the app was restarted meanwhile. */
  schedule(name, delay, fn) {
    this.timers.clearTimeout(this.scheduled.get(name));
    const generation = this.generation;
    this.scheduled.set(
      name,
      this.timers.setTimeout(() => {
        this.scheduled.delete(name);
        if (generation === this.generation) {
          Promise.resolve()
            .then(fn)
            .catch((err) => this.logger.error(`${name} failed: ${err.message}`));
        }
      }, delay),
    );
  }

  /** Runs `fn` unless the same job is already running (then waits for it). */
  once(name, fn) {
    if (!this.running.has(name)) {
      const generation = this.generation;
      this.running.set(
        name,
        Promise.resolve()
          .then(fn)
          .finally(() => {
            if (generation === this.generation) {
              this.running.delete(name);
            }
          }),
      );
    }
    return this.running.get(name);
  }

  async pollAll(generation) {
    if (this.airstage) {
      await this.pollAirstage(generation);
    }
    if (this.locals.size > 0) {
      await this.pollLocals(generation);
    }
    if (this.fglair) {
      await this.pollFglair(generation);
    }
  }

  // --- Units -----------------------------------------------------------------

  entryOf(kind, id, { name, model, modelType } = {}) {
    const key = `${kind}:${id}`;
    let entry = this.units.get(key);
    if (!entry) {
      entry = {
        key,
        kind,
        id,
        name: null,
        model: null,
        modelType: modelType ?? null,
        supported: null,
        fields: emptyFields(),
        ids: idsOf(this.gladys, kind, id),
        cloud: { present: false, online: false },
        cloudParams: null,
        meta: {},
        lastSource: null,
        unknown: new Set(),
      };
      this.units.set(key, entry);
    }
    const local = kind === DEVICE_TYPES.AIRSTAGE ? this.locals.get(id) : null;
    entry.name =
      local?.unit.name ??
      name ??
      entry.name ??
      `${texts(this.config.language).unit} ${id.slice(-4)}`;
    entry.model = model || entry.model;
    return entry;
  }

  /** The way a unit is reached right now: 'local', 'cloud' or null. */
  sourceOf(entry) {
    if (entry.kind === DEVICE_TYPES.FGLAIR) {
      return this.sources.fglair.status === 'ok' && entry.cloud.present && entry.cloud.online
        ? 'cloud'
        : null;
    }
    const local = this.locals.get(entry.id);
    const localOk = local?.ok === true;
    const cloudOk =
      this.sources.airstage.status === 'ok' && entry.cloud.present && entry.cloud.online;
    if (this.config.preferLocal) {
      return localOk ? 'local' : cloudOk ? 'cloud' : null;
    }
    return cloudOk ? 'cloud' : localOk ? 'local' : null;
  }

  /**
   * An Airstage unit takes the last reading of the way it is reached now: the
   * other way's readings are kept for a switch, never mixed in.
   */
  refreshEntry(entry) {
    const source = this.sourceOf(entry);
    if (source !== entry.lastSource && entry.lastSource !== null) {
      this.logger.info(`"${entry.name}": now through ${source ?? 'nothing (unreachable)'}`);
    }
    entry.lastSource = source;
    if (entry.kind !== DEVICE_TYPES.AIRSTAGE || !source) {
      return;
    }
    const params = source === 'local' ? this.locals.get(entry.id)?.params : entry.cloudParams;
    if (params) {
      this.applyAirstage(entry, params);
    }
  }

  applyAirstage(entry, params) {
    const { fields, unknown } = parseAirstage(params);
    this.noteUnknown(entry, unknown);
    entry.fields = mergeFields(entry.fields, fields);
    this.pushStates(entry);
  }

  applyFglair(entry, props) {
    const { fields, unknown } = parseFglair(props, entry.modelType);
    this.noteUnknown(entry, unknown);
    entry.fields = mergeFields(entry.fields, fields);
    this.pushStates(entry);
  }

  noteUnknown(entry, unknown) {
    for (const value of unknown) {
      if (!entry.unknown.has(value)) {
        entry.unknown.add(value);
        this.logger.warn(`"${entry.name}": unknown value ${value}`);
      }
    }
  }

  // --- Airstage cloud --------------------------------------------------------

  pollAirstage(generation) {
    return this.once('airstage', async () => {
      const source = this.sources.airstage;
      let devices;
      try {
        devices = await this.airstage.listDevices();
      } catch (err) {
        if (generation === this.generation) {
          await this.sourceFailed('airstage', err, () => this.pollAirstage(generation));
        }
        return;
      }
      if (generation !== this.generation) {
        return;
      }
      const first = source.status !== 'ok';
      Object.assign(source, { status: 'ok', error: null, backoff: 0, rate: 0 });
      source.count = devices.length;
      if (first) {
        this.logger.info(`Airstage cloud: ${devices.length} unit(s) on the account`);
      }
      const seen = new Set();
      for (const device of devices) {
        const entry = this.entryOf(DEVICE_TYPES.AIRSTAGE, device.id, device);
        seen.add(entry.key);
        entry.cloud = { present: true, online: device.online };
        entry.cloudParams = device.params;
        entry.supported = mergeSupported(entry.supported, supportedAirstage(device.params));
        this.refreshEntry(entry);
      }
      for (const entry of this.units.values()) {
        if (entry.kind === DEVICE_TYPES.AIRSTAGE && !seen.has(entry.key)) {
          entry.cloud = { present: false, online: false };
          this.refreshEntry(entry);
        }
      }
      await this.publishAll();
      this.schedule('airstage poll', TIMINGS.airstagePoll, () => this.pollAirstage(generation));
    });
  }

  /** Follows a cloud command until the unit took it, then applies what it says. */
  async followRequest(entry, reqId, generation) {
    for (let i = 0; i < TIMINGS.requestStatusTries; i += 1) {
      await new Promise((resolve) =>
        this.timers.setTimeout(resolve, TIMINGS.requestStatusInterval),
      );
      if (generation !== this.generation) {
        return;
      }
      let status;
      try {
        status = await this.airstage.requestStatus(entry.id, reqId);
      } catch (err) {
        this.logger.debug(`"${entry.name}": command status unknown (${reasonOf(err)})`);
        return;
      }
      if (status.status !== 'waiting') {
        if (status.result && status.result !== 'success') {
          this.logger.warn(`"${entry.name}": the unit did not take the command (${status.result})`);
        }
        if (Object.keys(status.params).length > 0) {
          entry.cloudParams = { ...(entry.cloudParams ?? {}), ...status.params };
          if (this.sourceOf(entry) === 'cloud') {
            this.applyAirstage(entry, status.params);
            await this.flush();
          }
        }
        return;
      }
    }
    this.logger.warn(`"${entry.name}": the command is still waiting for the unit`);
  }

  // --- Airstage Wi-Fi adapters -----------------------------------------------

  pollLocals(generation, { force = false } = {}) {
    return this.once('local', async () => {
      for (const local of this.locals.values()) {
        if (generation !== this.generation) {
          return;
        }
        if (!force && local.ok === false && local.retryAt > this.now()) {
          continue;
        }
        await this.pollLocal(local, generation);
      }
      if (generation !== this.generation) {
        return;
      }
      await this.publishAll();
      this.schedule('local poll', TIMINGS.localPoll, () => this.pollLocals(generation));
    });
  }

  async pollLocal(local, generation) {
    const address = addressOf(local.unit);
    try {
      local.params = await local.client.read();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      local.failures += 1;
      local.error = reasonOf(err);
      if (local.ok !== false && (local.ok === null || local.failures >= TIMINGS.localFailures)) {
        local.ok = false;
        this.logger.warn(`Airstage adapter ${address}: ${local.error}`);
      }
      if (local.ok === false) {
        local.backoff = local.backoff
          ? Math.min(local.backoff * 2, TIMINGS.retryMax)
          : TIMINGS.localPoll;
        local.retryAt = this.now() + local.backoff;
      }
      const entry = this.units.get(`${DEVICE_TYPES.AIRSTAGE}:${local.unit.id}`);
      if (entry) {
        this.refreshEntry(entry);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    if (local.ok !== true) {
      this.logger.info(`Airstage adapter ${address}: reachable`);
    }
    Object.assign(local, { ok: true, failures: 0, error: null, backoff: 0, retryAt: 0 });
    const entry = this.entryOf(DEVICE_TYPES.AIRSTAGE, local.unit.id, {
      model: local.client.model || null,
    });
    entry.supported = mergeSupported(entry.supported, supportedAirstage(local.params));
    this.refreshEntry(entry);
  }

  // --- FGLair cloud ----------------------------------------------------------

  pollFglair(generation) {
    return this.once('fglair', async () => {
      const source = this.sources.fglair;
      let devices;
      try {
        devices = await this.fglair.listDevices();
        for (const device of devices) {
          if (!device.online) {
            continue;
          }
          const { props, meta } = await this.fglair.properties(device.id);
          if (generation !== this.generation) {
            return;
          }
          const name =
            typeof props[FGLAIR.NAME] === 'string' && props[FGLAIR.NAME].trim()
              ? props[FGLAIR.NAME].trim().slice(0, 100)
              : device.name;
          const entry = this.entryOf(DEVICE_TYPES.FGLAIR, device.id, { ...device, name });
          entry.meta = meta;
          entry.supported = mergeSupported(
            entry.supported,
            supportedFglair(props, device.modelType),
          );
          entry.cloud = { present: true, online: true };
          entry.lastSource = 'cloud';
          this.applyFglair(entry, props);
          if (entry.supported.indoor) {
            // The next poll gets a fresh room temperature (Home Assistant asks at every update).
            await this.fglair
              .requestRefresh(device.id, meta)
              .catch((err) => this.logger.debug(`FGLair refresh request failed: ${reasonOf(err)}`));
          }
        }
      } catch (err) {
        if (generation === this.generation) {
          await this.sourceFailed('fglair', err, () => this.pollFglair(generation));
        }
        return;
      }
      if (generation !== this.generation) {
        return;
      }
      const first = source.status !== 'ok';
      Object.assign(source, { status: 'ok', error: null, backoff: 0, rate: 0 });
      source.count = devices.length;
      if (first) {
        this.logger.info(`FGLair cloud: ${devices.length} unit(s) on the account`);
      }
      const online = new Map(devices.map((d) => [d.id, d.online]));
      for (const entry of this.units.values()) {
        if (entry.kind === DEVICE_TYPES.FGLAIR) {
          entry.cloud = { present: online.has(entry.id), online: online.get(entry.id) === true };
          entry.lastSource = this.sourceOf(entry);
        }
      }
      await this.publishAll();
      this.schedule('fglair poll', TIMINGS.fglairPoll, () => this.pollFglair(generation));
    });
  }

  /** Reads one FGLair unit again (after a command). */
  async reloadFglairUnit(entry) {
    const { props, meta } = await this.fglair.properties(entry.id);
    entry.meta = meta;
    this.applyFglair(entry, props);
    await this.flush();
  }

  // --- Failures --------------------------------------------------------------

  async sourceFailed(name, err, retry) {
    const source = this.sources[name];
    source.error = reasonOf(err);
    if (err instanceof FujitsuAuthError) {
      // Never retried on its own: the user fixes the password and saves.
      source.status = 'refused';
      this.logger.warn(`${name}: ${source.error}`);
    } else if (err instanceof FujitsuRateLimited) {
      source.status = 'rate';
      source.rate = source.rate
        ? Math.min(source.rate * 3, TIMINGS.rateLimitMax)
        : TIMINGS.rateLimitMin;
      source.wait = Math.max(err.retryAfter ?? 0, source.rate);
      this.logger.warn(
        `${name}: ${source.error}, next attempt in ${Math.round(source.wait / 1000)} s`,
      );
      this.schedule(`${name} poll`, source.wait, retry);
    } else {
      source.status = 'down';
      source.backoff = source.backoff
        ? Math.min(source.backoff * 2, TIMINGS.retryMax)
        : TIMINGS.retryMin;
      source.wait = source.backoff;
      this.logger.warn(`${name}: ${source.error}`);
      this.schedule(`${name} poll`, source.wait, retry);
    }
    for (const entry of this.units.values()) {
      this.refreshEntry(entry);
    }
    await this.publishAll();
  }

  // --- Publication -----------------------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  /** The devices of the known units (a unit is known once a source read it). */
  devices() {
    return [...this.units.values()]
      .filter((e) => e.supported)
      .map((entry) => buildDevice(entry, this.config.language));
  }

  rebuildRoutes(devices) {
    this.routes.clear();
    const byDevice = new Map([...this.units.values()].map((e) => [e.ids.device, e]));
    for (const device of devices) {
      const entry = byDevice.get(device.external_id);
      for (const feature of device.features) {
        this.routes.set(feature.external_id, {
          entry,
          key: feature.external_id.slice(entry.ids.device.length + 1),
        });
      }
    }
  }

  async publishDevices({ force = false } = {}) {
    const devices = this.devices();
    this.rebuildRoutes(devices);
    const key = JSON.stringify(devices);
    if (!force && key === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = key;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** Queues the states of a unit the user added (Gladys drops the others). */
  pushStates(entry) {
    if (!entry.supported || !this.createdDevices().has(entry.ids.device)) {
      return;
    }
    for (const [key, value] of statesOf(entry, entry.fields)) {
      this.publisher.push(entry.ids.feature(key), value);
    }
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending the states failed: ${err.message}`));
  }

  /** After every poll: devices when they changed, states, status, badges. */
  async publishAll() {
    await this.publishDevices();
    await this.flush();
    await this.reportStatus();
    await this.publishTransports();
  }

  transportOf(entry) {
    const source = this.sourceOf(entry);
    if (!source) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (entry.kind === DEVICE_TYPES.AIRSTAGE && this.locals.has(entry.id) && entry.cloud.present) {
      if (source === 'cloud' && this.config.preferLocal) {
        return { transport: DEVICE_TRANSPORTS.CLOUD, degraded: true, message: T.badge.localDown };
      }
      if (source === 'local' && !this.config.preferLocal) {
        return { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: T.badge.cloudDown };
      }
    }
    return { transport: source === 'local' ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD };
  }

  async publishTransports() {
    const created = this.createdDevices();
    const entries = [];
    for (const entry of this.units.values()) {
      const externalId = entry.ids.device;
      const transport = { external_id: externalId, ...this.transportOf(entry) };
      const key = JSON.stringify(transport);
      if (created.has(externalId) && this.transports.get(externalId) !== key) {
        this.transports.set(externalId, key);
        entries.push(transport);
      }
    }
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** Notes about the configuration itself (half-filled accounts, unreadable adapter entries). */
  configNotes() {
    const notes = this.config.incomplete.map((source) => T.incomplete(source));
    if (this.config.localInvalid.length > 0) {
      notes.push(T.localInvalid(this.config.localInvalid));
    }
    return notes;
  }

  async reportStatus() {
    const parts = [...this.configNotes()];
    let connected = false;
    for (const name of ['airstage', 'fglair']) {
      if (!this[name]) {
        continue;
      }
      const source = this.sources[name];
      if (source.status === 'ok') {
        connected = true;
        parts.push(source.count > 0 ? T.units(name, source.count) : T.noUnit(name));
      } else if (source.status === 'refused') {
        parts.push(T.refused(name));
      } else if (source.status === 'rate') {
        parts.push(T.rateLimited(name, source.wait));
      } else if (source.status === 'down') {
        parts.push(T.unreachable(name, source.error, source.wait));
      }
    }
    if (this.locals.size > 0) {
      const up = [...this.locals.values()].filter((l) => l.ok === true).length;
      connected ||= up > 0;
      parts.push(T.adapters(up, this.locals.size));
    }
    const created = this.createdDevices();
    if (connected && [...this.units.values()].some((e) => !created.has(e.ids.device))) {
      parts.push(T.addThem);
    }
    await this.setStatus(connected, join(parts));
  }

  /** Gladys reconnected: publish again what it may have lost. */
  async resync() {
    this.transports.clear();
    this.lastStatus = undefined;
    await this.publishDevices({ force: true });
    this.gladys.forgetPublishedStates();
    for (const entry of this.units.values()) {
      this.pushStates(entry);
    }
    await this.flush();
    await this.reportStatus();
    await this.publishTransports();
  }

  // --- Devices created by the user -----------------------------------------

  entryOfDevice(externalId) {
    return [...this.units.values()].find((e) => e.ids.device === externalId);
  }

  async deviceCreated(device) {
    const entry = this.entryOfDevice(device?.external_id);
    if (entry) {
      this.transports.delete(entry.ids.device);
      this.pushStates(entry);
      await this.flush();
      await this.publishTransports();
      await this.reportStatus();
    }
  }

  async deviceDeleted(device) {
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery screen asks for the units: read every source again. */
  async scan() {
    if (!this.started) {
      return;
    }
    const generation = this.generation;
    if (this.airstage && this.sources.airstage.status !== 'refused') {
      await this.pollAirstage(generation);
    }
    if (this.locals.size > 0) {
      await this.pollLocals(generation, { force: true });
    }
    if (this.fglair && this.sources.fglair.status !== 'refused') {
      await this.pollFglair(generation);
    }
    await this.publishDevices({ force: true });
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    const route = this.routes.get(feature?.external_id);
    if (!route) {
      throw new Error('unknown Fujitsu feature: scan the units again');
    }
    const { entry, key } = route;
    const source = this.sourceOf(entry);
    if (!source) {
      throw new Error('this unit is unreachable for now: see the status of the integration');
    }
    // An UnsupportedError carries the message Gladys shows for the failed command.
    const change = changeOf(entry, key, value, entry.fields);
    const generation = this.generation;
    if (entry.kind === DEVICE_TYPES.FGLAIR) {
      for (const [name, v] of fglairDatapoints(change, entry.modelType, entry.fields.mode)) {
        const property = entry.meta[name];
        if (!property || property.readOnly) {
          throw new UnsupportedError(`this unit does not take ${name}`);
        }
        await this.fglair.setProperty(entry.id, property.name, v);
      }
      this.schedule(`fglair ${entry.id}`, TIMINGS.afterCommand, () => this.reloadFglairUnit(entry));
    } else {
      const params = airstageParams(change, entry.fields);
      if (source === 'local') {
        const local = this.locals.get(entry.id);
        await local.client.set(params);
        // Until the next reading, the kept one says what was just set.
        local.params = { ...(local.params ?? {}), ...params };
        this.schedule(`adapter ${entry.id}`, TIMINGS.afterCommand, async () => {
          await this.pollLocal(local, generation);
          await this.publishAll();
        });
      } else {
        const reqId = await this.airstage.setParameters(entry.id, params);
        entry.cloudParams = { ...(entry.cloudParams ?? {}), ...params };
        this.followRequest(entry, reqId, generation).catch((err) =>
          this.logger.warn(`"${entry.name}": following the command failed: ${err.message}`),
        );
      }
    }
    entry.fields = applyChange(entry.fields, change);
    this.pushStates(entry);
    await this.flush();
    this.logger.info(`"${entry.name}": ${key} set to ${value} (${source})`);
  }

  // --- Configuration screen button -------------------------------------------

  /**
   * Signs in to each configured cloud with the saved configuration (a real
   * sign-in: it checks the password) and reads each adapter once.
   */
  async testConnection() {
    if (this.config.missing.length > 0) {
      return T.notConfigured;
    }
    const parts = [...this.configNotes()];
    let restart = false;
    const tryCloud = async (name, client) => {
      try {
        await client.signIn();
        const devices = await client.listDevices();
        parts.push(
          T.test.ok(
            name,
            devices.map((d) => d.name),
          ),
        );
        restart ||= this.sources[name].status === 'refused';
      } catch (err) {
        if (err instanceof FujitsuAuthError) {
          parts.push(T.test.refused(name));
        } else if (err instanceof FujitsuRateLimited) {
          parts.push(T.test.rateLimited(name));
        } else {
          parts.push(T.test.failed(name, reasonOf(err)));
        }
      }
    };
    // The running clients sign in again: their new tokens replace the kept ones.
    if (this.airstage) {
      await tryCloud('airstage', this.airstage);
    }
    for (const local of this.locals.values()) {
      const address = addressOf(local.unit);
      try {
        await local.client.read();
        parts.push(T.test.adapterOk(address, local.client.model));
      } catch (err) {
        parts.push(T.test.adapterFailed(address, reasonOf(err)));
      }
    }
    if (this.fglair) {
      await tryCloud('fglair', this.fglair);
    }
    if (restart) {
      // The credentials work now: start again.
      this.start(this.rawConfig, { force: true }).catch((e) =>
        this.logger.error(`Start failed: ${e.message}`),
      );
    }
    return join(parts);
  }
}
