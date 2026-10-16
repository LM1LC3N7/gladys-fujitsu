// -----------------------------------------------------------------------------
// The local API of an Airstage Wi-Fi adapter (UTY-TFSXF3 and the built-in
// adapters of the units of the Airstage app), on the LAN: `POST /GetParam`
// with the names to read, `POST /SetParam` with the values to set, the MAC
// address of the adapter as `device_id`. No account, no cloud.
//
// Written from homebridge-fujitsu-airstage (Patrick Stankard, MIT, 4.0.0,
// src/airstage/lan/api/client.js, lan/client.js) and pyairstage (Daniel Rufus
// Kaldheim, MIT, 3.2.2, airstageApi.py ApiLocal), the library of ha_airstage:
// - the header names keep their case (lowercase names get "NG 0002",
//   homebridge-fujitsu-airstage #51);
// - at most 20 names per GetParam, `iu_model` read alone (it truncates the
//   answer), a pause between two requests (back-to-back requests get
//   dropped), one more try after a dropped connection;
// - recent adapters answer in HTTPS with a certificate that cannot match an
//   IP address (pyairstage 3.1.2 skips the check): `https://` in the address
//   forces it, else HTTP is tried first and HTTPS when HTTP is refused.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from './constants.js';
import {
  FujitsuConnectionError,
  FujitsuError,
  clip,
  defaultSleep,
  httpTransport,
  jsonOf,
} from './http.js';
import { AIRSTAGE, AIRSTAGE_LOCAL_READ, airstageParamsOf } from './units.js';

export const LOCAL_USER_AGENT = 'gladys-fujitsu';

/** The address of an adapter as written in the configuration. */
export const addressOf = (unit) => `${unit.host}${unit.port ? `:${unit.port}` : ''}`;

const DROPPED = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);

export class AirstageLocal {
  /**
   * @param {{ unit: { host: string, port: number | null, scheme: string | null, id: string },
   *   scheme?: string | null, onScheme?: Function, transport?: Function,
   *   sleep?: Function, now?: Function }} options scheme: the one kept from
   *   a previous run, when the configuration does not force one
   */
  constructor({
    unit,
    scheme = null,
    onScheme = () => {},
    transport = httpTransport,
    sleep = defaultSleep,
    now = Date.now,
  }) {
    this.unit = unit;
    this.scheme = unit.scheme ?? scheme ?? 'http';
    this.forced = unit.scheme !== null;
    this.onScheme = onScheme;
    this.transport = transport;
    this.sleep = sleep;
    this.now = now;
    this.lastRequest = 0;
    this.model = null;
  }

  get address() {
    return addressOf(this.unit);
  }

  async send(path, body, timeout) {
    const wait = this.lastRequest + TIMINGS.localGap - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    const text = JSON.stringify(body);
    const attempt = (scheme) =>
      this.transport({
        method: 'POST',
        url: `${scheme}://${this.address}${path}`,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': LOCAL_USER_AGENT,
          'Content-Length': String(Buffer.byteLength(text)),
        },
        body: text,
        timeout,
        limit: LIMITS.responseBytes,
        insecure: scheme === 'https',
      });
    let res;
    try {
      res = await attempt(this.scheme);
    } catch (err) {
      if (err instanceof FujitsuConnectionError && DROPPED.has(err.code)) {
        await this.sleep(TIMINGS.localGap);
        res = await attempt(this.scheme);
      } else if (
        err instanceof FujitsuConnectionError &&
        err.code === 'ECONNREFUSED' &&
        !this.forced &&
        this.scheme === 'http'
      ) {
        res = await attempt('https');
        this.scheme = 'https';
        this.onScheme('https');
      } else {
        throw err;
      }
    } finally {
      this.lastRequest = this.now();
    }
    if (res.status < 200 || res.status >= 300) {
      throw new FujitsuError(`adapter ${this.address}: HTTP ${res.status}`);
    }
    const json = jsonOf(res.body);
    if (!json || json.result !== 'OK') {
      const why = json
        ? `${clip(json.result, 10)} ${clip(json.error ?? '', 20)}`.trim()
        : 'not JSON';
      throw new FujitsuError(`adapter ${this.address} answered ${why}`);
    }
    return json;
  }

  request(level, extra) {
    return {
      device_id: this.unit.id,
      device_sub_id: 0,
      req_id: '',
      modified_by: '',
      set_level: level,
      ...extra,
    };
  }

  /** The parameters of the unit (and its model, read once). */
  async read({ timeout = TIMINGS.httpTimeout } = {}) {
    if (this.model === null) {
      const json = await this.send(
        '/GetParam',
        this.request('03', { list: [AIRSTAGE.MODEL] }),
        timeout,
      );
      const model = airstageParamsOf(json.value)[AIRSTAGE.MODEL];
      this.model = model && model !== '65535' ? clip(model, 60) : '';
    }
    const json = await this.send(
      '/GetParam',
      this.request('03', { list: AIRSTAGE_LOCAL_READ }),
      timeout,
    );
    return airstageParamsOf(json.value);
  }

  /** Sets parameters (string values); resolves with what the adapter answered. */
  async set(params, { timeout = TIMINGS.commandTimeout } = {}) {
    const json = await this.send('/SetParam', this.request('02', { value: params }), timeout);
    return airstageParamsOf(json.value);
  }
}
