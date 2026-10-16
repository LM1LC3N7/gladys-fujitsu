// -----------------------------------------------------------------------------
// The FGLair cloud (Ayla Networks), with the account of the Fujitsu FGLair
// app: sign-in with the application id of the app, token refresh, the device
// list, the properties of a unit and the datapoints that change them.
//
// Written from ayla-iot-unofficial (rewardone, MIT, 1.5.2,
// ayla_iot_unofficial.py, device.py, fujitsu_hvac.py), the library of the
// Home Assistant `fujitsu_fglair` integration: same hosts per region, bodies,
// `auth_token` header, `x-ayla-source: Mobile` on the datapoints. Cross-checked
// with homebridge-fujitsu-hvac (Daniel Hyckenberg, MIT) and the `fglair` npm
// client (ISC). The FGLair LAN mode needs the unit to call an HTTP server
// back: impossible from a Gladys container (no inbound port), so the cloud
// only. The password and the tokens are never logged nor put in an error
// message.
// -----------------------------------------------------------------------------

import { FGLAIR_REGIONS, LIMITS, TIMINGS } from './constants.js';
import {
  FujitsuAuthError,
  FujitsuError,
  FujitsuRateLimited,
  clip,
  httpTransport,
  jsonOf,
  retryAfterOf,
} from './http.js';
import { FGLAIR, fglairModelType, fglairPropsOf } from './units.js';

/** A token without a known lifetime is renewed after an hour. */
const DEFAULT_LIFETIME = 3600;

/** One device of the list, or null when it is not a Fujitsu air conditioner. */
function deviceOf(device) {
  const modelType = fglairModelType(device.oem_model);
  if (!modelType || !device.dsn) {
    return null;
  }
  return {
    id: String(device.dsn),
    name: clip(device.product_name || device.dsn, 100),
    online: String(device.connection_status ?? 'Online').toLowerCase() !== 'offline',
    model: clip(device.oem_model, 60),
    modelType,
  };
}

export class FglairCloud {
  /**
   * @param {{ account: { email: string, password: string, region: string },
   *   session?: object | null, onSession?: Function, transport?: Function,
   *   now?: Function, logger?: object }} options
   */
  constructor({
    account,
    session = null,
    onSession = () => {},
    transport = httpTransport,
    now = Date.now,
    logger,
  }) {
    this.account = account;
    this.region = FGLAIR_REGIONS[account.region] ?? FGLAIR_REGIONS.eu;
    this.session = session;
    this.onSession = onSession;
    this.transport = transport;
    this.now = now;
    this.logger = logger;
    this.signingIn = undefined;
  }

  async exchange(method, url, { body, token = true, headers = {}, timeout } = {}) {
    const all = { 'Content-Type': 'application/json', Accept: 'application/json', ...headers };
    if (token) {
      all.Authorization = `auth_token ${this.session.accessToken}`;
    }
    const res = await this.transport({
      method,
      url,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: timeout ?? TIMINGS.httpTimeout,
      limit: LIMITS.responseBytes,
    });
    if (res.status === 429) {
      throw new FujitsuRateLimited(
        'FGLair: too many requests (HTTP 429)',
        retryAfterOf(res.headers?.['retry-after'], this.now()),
      );
    }
    return { status: res.status, json: jsonOf(res.body) };
  }

  storeSession(json) {
    if (typeof json?.access_token !== 'string' || json.access_token === '') {
      throw new FujitsuError('FGLair: no access token in the answer');
    }
    const lifetime = Number(json.expires_in) > 0 ? Number(json.expires_in) : DEFAULT_LIFETIME;
    this.session = {
      accessToken: json.access_token,
      refreshToken:
        typeof json.refresh_token === 'string' ? json.refresh_token : this.session?.refreshToken,
      expiresAt: this.now() + lifetime * 1000,
    };
    this.onSession(this.session);
  }

  /** Signs in with the e-mail and the password. A refusal throws FujitsuAuthError. */
  async signIn() {
    const { status, json } = await this.exchange('POST', `${this.region.user}/users/sign_in.json`, {
      token: false,
      body: {
        user: {
          email: this.account.email,
          password: this.account.password,
          application: { app_id: this.region.appId, app_secret: this.region.appSecret },
        },
      },
    });
    if (status === 401 || status === 422) {
      this.session = null;
      this.onSession(null);
      throw new FujitsuAuthError('FGLair refused the e-mail or the password');
    }
    if (status === 404) {
      throw new FujitsuError('FGLair sign-in: unknown application (HTTP 404), wrong region?');
    }
    if (status < 200 || status >= 300) {
      throw new FujitsuError(`FGLair sign-in: HTTP ${status}`);
    }
    this.storeSession(json);
  }

  /** Renews the access token; false when the refresh token is refused. */
  async refresh() {
    if (!this.session?.refreshToken) {
      return false;
    }
    const { status, json } = await this.exchange(
      'POST',
      `${this.region.user}/users/refresh_token.json`,
      { token: false, body: { user: { refresh_token: this.session.refreshToken } } },
    );
    if (status < 200 || status >= 300) {
      this.logger?.debug?.(`FGLair token refresh refused (HTTP ${status})`);
      return false;
    }
    this.storeSession(json);
    return true;
  }

  /** A valid token: the kept one, a refreshed one, else a new sign-in (one at a time). */
  async ensureSession({ renew = false } = {}) {
    const fresh =
      this.session?.accessToken &&
      (!this.session.expiresAt || this.session.expiresAt - TIMINGS.tokenMargin > this.now());
    if (fresh && !renew) {
      return;
    }
    if (!this.signingIn) {
      this.signingIn = (async () => {
        if (this.session && (await this.refresh())) {
          return;
        }
        await this.signIn();
      })().finally(() => {
        this.signingIn = undefined;
      });
    }
    await this.signingIn;
  }

  /** An authenticated call on the device service; a refused token is renewed once. */
  async call(method, path, { body, headers, timeout } = {}) {
    await this.ensureSession();
    const url = `${this.region.ads}${path}`;
    let answer = await this.exchange(method, url, { body, headers, timeout });
    if (answer.status === 401) {
      await this.ensureSession({ renew: true });
      answer = await this.exchange(method, url, { body, headers, timeout });
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new FujitsuError(`FGLair: HTTP ${answer.status}`);
    }
    return answer.json;
  }

  /** The Fujitsu air conditioners of the account (other Ayla devices are left out). */
  async listDevices() {
    const json = await this.call('GET', '/apiv1/devices.json');
    if (!Array.isArray(json)) {
      throw new FujitsuError('FGLair: unreadable device list');
    }
    const devices = json
      .map((entry) => (entry?.device ? deviceOf(entry.device) : null))
      .filter(Boolean)
      .slice(0, LIMITS.units);
    const skipped = json.length - devices.length;
    if (skipped > 0) {
      this.logger?.debug?.(`FGLair: ${skipped} device(s) of the account are not Fujitsu units`);
    }
    return devices;
  }

  /** The properties of a unit: { props: name -> value, meta: name -> { name, readOnly } }. */
  async properties(dsn) {
    const json = await this.call('GET', `/apiv1/dsns/${encodeURIComponent(dsn)}/properties.json`);
    if (!Array.isArray(json)) {
      throw new FujitsuError('FGLair: unreadable properties');
    }
    return fglairPropsOf(json);
  }

  /** Posts one datapoint (the full property name, as the list gave it). */
  async setProperty(dsn, name, value, { timeout = TIMINGS.commandTimeout } = {}) {
    await this.call(
      'POST',
      `/apiv1/dsns/${encodeURIComponent(dsn)}/properties/${encodeURIComponent(name)}/datapoints.json`,
      { body: { datapoint: { value } }, headers: { 'x-ayla-source': 'Mobile' }, timeout },
    );
  }

  /** Asks an A/F module to measure the room temperature again (Home Assistant does it at every update). */
  async requestRefresh(dsn, meta) {
    const name = meta[FGLAIR.REFRESH]?.name;
    if (name && !meta[FGLAIR.REFRESH].readOnly) {
      await this.setProperty(dsn, name, 1, { timeout: TIMINGS.httpTimeout });
    }
  }
}
