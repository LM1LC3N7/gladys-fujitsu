// -----------------------------------------------------------------------------
// The Airstage cloud (bke.<region>.airstagelight.com/apiv1), with the account
// of the Fujitsu Airstage app: sign-in, token refresh, the device list (every
// unit with all its parameters) and the commands (a "set parameters request",
// then its status).
//
// Written from homebridge-fujitsu-airstage (Patrick Stankard, MIT, 4.0.0,
// src/airstage/cloud/apiv1/client.js and cloud/client.js) and pyairstage
// (Daniel Rufus Kaldheim, MIT, 3.2.2, airstageApi.py ApiCloud): same paths,
// bodies and error codes. The headers are pyairstage's (content type, an iOS
// User-Agent, the bearer token), without the browser `sec-fetch-*` and
// `accept-encoding` ones of the plugin: the answer must not be compressed.
// The password and the tokens are never logged nor put in an error message.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { AIRSTAGE_HOSTS, LIMITS, TIMINGS } from './constants.js';
import {
  FujitsuAuthError,
  FujitsuError,
  FujitsuRateLimited,
  clip,
  httpTransport,
  jsonOf,
  retryAfterOf,
} from './http.js';
import { airstageParamsOf } from './units.js';

export const AIRSTAGE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const OS_VERSION = 'iOS 17.4.1';

export const AIRSTAGE_PATHS = {
  SIGN_IN: '/apiv1/users/sign_in',
  REFRESH: '/apiv1/users/me/refresh_token',
  DEVICES: '/apiv1/devices/all',
  SET: (id) => `/apiv1/devices/${encodeURIComponent(id)}/set_parameters_request`,
  REQUEST: (id, req) =>
    `/apiv1/devices/${encodeURIComponent(id)}/requests/${encodeURIComponent(req)}`,
};

const INVALID_LOGIN = 'AIRSTAGE_POST_USERS_SIGNIN_EMAIL_PASSWORD_INVALID';
const INVALID_TOKEN = 'AIRSTAGE_COMMON_TOKEN_INVALID';

/** A token without a known lifetime is renewed after an hour. */
const DEFAULT_LIFETIME = 3600;

/** One unit of the device list. */
function deviceOf(device) {
  const params = airstageParamsOf(device.parameters);
  return {
    id: String(device.deviceId ?? '').toUpperCase(),
    name: clip(device.deviceName || device.deviceId || 'Fujitsu Airstage', 100),
    online: String(device.connectionStatus ?? 'Online').toLowerCase() !== 'offline',
    model: params.iu_model && params.iu_model !== '65535' ? clip(params.iu_model, 60) : null,
    params,
  };
}

export class AirstageCloud {
  /**
   * @param {{ account: { email: string, password: string, region: string, country: string },
   *   deviceToken: string, session?: object | null, onSession?: Function,
   *   transport?: Function, now?: Function, logger?: object }} options
   */
  constructor({
    account,
    deviceToken,
    session = null,
    onSession = () => {},
    transport = httpTransport,
    now = Date.now,
    logger,
  }) {
    this.account = account;
    this.host = AIRSTAGE_HOSTS[account.region] ?? AIRSTAGE_HOSTS.eu;
    this.deviceToken = deviceToken;
    this.session = session;
    this.onSession = onSession;
    this.transport = transport;
    this.now = now;
    this.logger = logger;
    this.signingIn = undefined;
  }

  headers(withToken) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': AIRSTAGE_USER_AGENT,
    };
    if (withToken) {
      headers.Authorization = `Bearer ${this.session.accessToken}`;
    }
    return headers;
  }

  /** One exchange; the body is parsed, the HTTP errors turned into error kinds. */
  async exchange(method, path, { body, token = true, timeout = TIMINGS.httpTimeout } = {}) {
    const res = await this.transport({
      method,
      url: `https://${this.host}${path}`,
      headers: this.headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout,
      limit: LIMITS.responseBytes,
    });
    const json = jsonOf(res.body);
    const code = typeof json?.messageCode === 'string' ? json.messageCode : null;
    if (res.status === 429) {
      throw new FujitsuRateLimited(
        'Airstage: too many requests (HTTP 429)',
        retryAfterOf(res.headers?.['retry-after'], this.now()),
      );
    }
    return { status: res.status, json, code };
  }

  storeSession(json) {
    if (typeof json?.accessToken !== 'string' || json.accessToken === '') {
      throw new FujitsuError('Airstage: no access token in the answer');
    }
    const lifetime = Number(json.expiresIn) > 0 ? Number(json.expiresIn) : DEFAULT_LIFETIME;
    this.session = {
      accessToken: json.accessToken,
      refreshToken:
        typeof json.refreshToken === 'string' ? json.refreshToken : this.session?.refreshToken,
      expiresAt: this.now() + lifetime * 1000,
    };
    this.onSession(this.session);
  }

  /** Signs in with the e-mail and the password. A refusal throws FujitsuAuthError. */
  async signIn() {
    const { status, json, code } = await this.exchange('POST', AIRSTAGE_PATHS.SIGN_IN, {
      token: false,
      body: {
        user: {
          country: this.account.country,
          deviceToken: this.deviceToken,
          email: this.account.email,
          language: 'en',
          osVersion: OS_VERSION,
          password: this.account.password,
          ssid: randomUUID(),
        },
      },
    });
    if (status === 401 || code === INVALID_LOGIN) {
      this.session = null;
      this.onSession(null);
      throw new FujitsuAuthError('Airstage refused the e-mail or the password');
    }
    if (status < 200 || status >= 300) {
      throw new FujitsuError(`Airstage sign-in: HTTP ${status}${code ? ` ${clip(code, 60)}` : ''}`);
    }
    this.storeSession(json);
  }

  /** Renews the access token; false when the refresh token is refused. */
  async refresh() {
    if (!this.session?.refreshToken) {
      return false;
    }
    const { status, json, code } = await this.exchange('POST', AIRSTAGE_PATHS.REFRESH, {
      token: false,
      body: { user: { refreshToken: this.session.refreshToken } },
    });
    if (status < 200 || status >= 300 || code === INVALID_TOKEN) {
      this.logger?.debug?.(`Airstage token refresh refused (HTTP ${status})`);
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

  /** An authenticated call; a refused token is renewed once. */
  async call(method, path, { body, timeout } = {}) {
    await this.ensureSession();
    let answer = await this.exchange(method, path, { body, timeout });
    if (answer.status === 401 || answer.status === 403 || answer.code === INVALID_TOKEN) {
      await this.ensureSession({ renew: true });
      answer = await this.exchange(method, path, { body, timeout });
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new FujitsuError(
        `Airstage: HTTP ${answer.status}${answer.code ? ` ${clip(answer.code, 60)}` : ''}`,
      );
    }
    return answer.json;
  }

  /** The units of the account, with all their parameters. */
  async listDevices() {
    const json = await this.call('GET', `${AIRSTAGE_PATHS.DEVICES}?limit=${LIMITS.units}`);
    if (!json || !Array.isArray(json.devices)) {
      throw new FujitsuError('Airstage: unreadable device list');
    }
    return json.devices
      .filter((d) => d && d.deviceId)
      .slice(0, LIMITS.units)
      .map(deviceOf);
  }

  /** Asks the unit to take parameters; resolves with the request id. */
  async setParameters(deviceId, params) {
    const json = await this.call('POST', AIRSTAGE_PATHS.SET(deviceId), {
      timeout: TIMINGS.commandTimeout,
      body: {
        deviceSubId: 0,
        parameters: Object.entries(params).map(([name, desiredValue]) => ({ name, desiredValue })),
      },
    });
    if (json?.reqId === undefined || json?.reqId === null) {
      throw new FujitsuError('Airstage: the command was not accepted (no request id)');
    }
    return String(json.reqId);
  }

  /** The status of a command: 'waiting' until the unit took it, then its parameters. */
  async requestStatus(deviceId, reqId) {
    const json = await this.call('GET', AIRSTAGE_PATHS.REQUEST(deviceId, reqId));
    return {
      status: String(json?.status ?? ''),
      result: json?.result === undefined ? null : String(json.result),
      params: airstageParamsOf(json?.parameters),
    };
  }
}
