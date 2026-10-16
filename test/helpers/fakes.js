// -----------------------------------------------------------------------------
// Fakes of the Fujitsu services, for the tests (no network):
// - createFakeAirstage / createFakeFglair: the clouds, as transports for the
//   clients (the shape of src/http.js httpTransport), answering like the
//   reference projects expect, recording every request;
// - startFakeAdapter: an Airstage Wi-Fi adapter on the loopback (a real HTTP
//   server), strict like the real one about the case of the header names;
// - an in-memory fs and timers run by hand.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export const AIRSTAGE_ACCOUNT = {
  email: 'jean@example.com',
  password: 'secret-airstage',
  region: 'eu',
  country: 'France',
};
export const FGLAIR_ACCOUNT = {
  email: 'marie@example.com',
  password: 'secret-fglair',
  region: 'eu',
};

const answer = (status, body, headers = {}) => ({
  status,
  headers,
  body: body === undefined ? '' : JSON.stringify(body),
});

function recorder(api, { method, url, headers, body, timeout, insecure }) {
  const u = new URL(url);
  const request = {
    method,
    host: u.host,
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    headers,
    body: body === undefined ? undefined : JSON.parse(body),
    timeout,
    insecure,
  };
  api.requests.push(request);
  return request;
}

const counts = (api) => () => {
  const out = {};
  for (const r of api.requests) {
    const key = `${r.method} ${r.path}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};

/** The Airstage cloud (bke.euro.airstagelight.com/apiv1). */
export function createFakeAirstage({ account = AIRSTAGE_ACCOUNT } = {}) {
  let tokens = 0;
  let requests = 0;
  const api = {
    requests: [],
    devices: fixture('airstage-devices.json').devices,
    valid: new Set(),
    refresh: new Set(),
    /** reqId -> { deviceId, polls } */
    pending: new Map(),
    /** Statuses (or functions) answered instead of the next requests. */
    next: [],
    down: null,
  };
  api.counts = counts(api);
  const issue = () => {
    tokens += 1;
    const token = { accessToken: `as-token-${tokens}`, refreshToken: `as-refresh-${tokens}` };
    api.valid.add(token.accessToken);
    api.refresh.add(token.refreshToken);
    return { ...token, expiresIn: 3600 };
  };
  const paramsOf = (device) => device.parameters.map(({ name, value }) => ({ name, value }));

  api.transport = async (options) => {
    const request = recorder(api, options);
    if (api.down) {
      throw api.down;
    }
    const forced = api.next.shift();
    if (typeof forced === 'function') {
      return forced(request);
    }
    if (typeof forced === 'number') {
      return answer(forced, {});
    }
    const { method, path, body } = request;
    if (method === 'POST' && path === '/apiv1/users/sign_in') {
      const user = body?.user ?? {};
      if (user.email !== account.email || user.password !== account.password) {
        return answer(401, { messageCode: 'AIRSTAGE_POST_USERS_SIGNIN_EMAIL_PASSWORD_INVALID' });
      }
      return answer(200, issue());
    }
    if (method === 'POST' && path === '/apiv1/users/me/refresh_token') {
      if (!api.refresh.has(body?.user?.refreshToken)) {
        return answer(403, { messageCode: 'AIRSTAGE_COMMON_TOKEN_INVALID' });
      }
      return answer(200, issue());
    }
    const token = String(request.headers.Authorization ?? '').replace(/^Bearer /, '');
    if (!api.valid.has(token)) {
      return answer(403, { messageCode: 'AIRSTAGE_COMMON_TOKEN_INVALID' });
    }
    if (method === 'GET' && path === '/apiv1/devices/all') {
      return answer(200, { devices: structuredClone(api.devices) });
    }
    let match = /^\/apiv1\/devices\/([^/]+)\/set_parameters_request$/.exec(path);
    if (method === 'POST' && match) {
      const device = api.devices.find((d) => d.deviceId === match[1]);
      if (!device) {
        return answer(404, { messageCode: 'AIRSTAGE_DEVICE_NOT_FOUND' });
      }
      for (const { name, desiredValue } of body.parameters) {
        const p = device.parameters.find((x) => x.name === name);
        if (p) {
          p.value = desiredValue;
        } else {
          device.parameters.push({ name, value: desiredValue });
        }
      }
      requests += 1;
      const reqId = `req-${requests}`;
      api.pending.set(reqId, { deviceId: device.deviceId, polls: 0 });
      return answer(200, { reqId });
    }
    match = /^\/apiv1\/devices\/([^/]+)\/requests\/([^/]+)$/.exec(path);
    if (method === 'GET' && match) {
      const pending = api.pending.get(match[2]);
      if (!pending) {
        return answer(404, {});
      }
      pending.polls += 1;
      if (pending.polls === 1) {
        return answer(200, { status: 'waiting' });
      }
      const device = api.devices.find((d) => d.deviceId === pending.deviceId);
      return answer(200, { status: 'complete', result: 'success', parameters: paramsOf(device) });
    }
    return answer(404, {});
  };
  /** Invalidates every access token (as if they expired server side). */
  api.expireTokens = () => api.valid.clear();
  api.device = (id) => api.devices.find((d) => d.deviceId === id);
  api.param = (id, name) => api.device(id).parameters.find((p) => p.name === name)?.value;
  return api;
}

/** The FGLair cloud (Ayla Networks, EU hosts). */
export function createFakeFglair({ account = FGLAIR_ACCOUNT } = {}) {
  let tokens = 0;
  const api = {
    requests: [],
    devices: fixture('fglair-devices.json'),
    properties: fixture('fglair-properties.json'),
    valid: new Set(),
    refresh: new Set(),
    next: [],
    down: null,
  };
  api.counts = counts(api);
  const issue = () => {
    tokens += 1;
    const token = { access_token: `ay-token-${tokens}`, refresh_token: `ay-refresh-${tokens}` };
    api.valid.add(token.access_token);
    api.refresh.add(token.refresh_token);
    return { ...token, expires_in: 86400, role: 'EndUser', role_tags: [] };
  };

  api.transport = async (options) => {
    const request = recorder(api, options);
    if (api.down) {
      throw api.down;
    }
    const forced = api.next.shift();
    if (typeof forced === 'function') {
      return forced(request);
    }
    if (typeof forced === 'number') {
      return answer(forced, {});
    }
    const { method, host, path, body } = request;
    if (method === 'POST' && host === 'user-field-eu.aylanetworks.com') {
      if (path === '/users/sign_in.json') {
        const user = body?.user ?? {};
        if (user.application?.app_id !== 'FGLair-eu-id') {
          return answer(404, { error: 'Could not find application' });
        }
        if (user.email !== account.email || user.password !== account.password) {
          return answer(401, { error: 'Your email or password is incorrect.' });
        }
        return answer(200, issue());
      }
      if (path === '/users/refresh_token.json') {
        if (!api.refresh.has(body?.user?.refresh_token)) {
          return answer(401, { error: 'Your refresh token is invalid.' });
        }
        return answer(200, issue());
      }
    }
    if (host !== 'ads-eu.aylanetworks.com') {
      return answer(404, {});
    }
    const token = String(request.headers.Authorization ?? '').replace(/^auth_token /, '');
    if (!api.valid.has(token)) {
      return answer(401, { error: 'Your access token is invalid or expired.' });
    }
    if (method === 'GET' && path === '/apiv1/devices.json') {
      return answer(200, structuredClone(api.devices));
    }
    let match = /^\/apiv1\/dsns\/([^/]+)\/properties\.json$/.exec(path);
    if (method === 'GET' && match) {
      const list = api.properties[match[1]];
      return list ? answer(200, structuredClone(list)) : answer(404, { error: 'Device not found' });
    }
    match = /^\/apiv1\/dsns\/([^/]+)\/properties\/([^/]+)\/datapoints\.json$/.exec(path);
    if (method === 'POST' && match) {
      const p = (api.properties[match[1]] ?? []).find((x) => x.property.name === match[2]);
      if (!p) {
        return answer(404, { error: 'Property not found' });
      }
      if (p.property.read_only) {
        return answer(422, { errors: { base: ['read only'] } });
      }
      if (p.property.name !== 'refresh') {
        p.property.value = body.datapoint.value;
      }
      return answer(201, {
        datapoint: {
          value: body.datapoint.value,
          created_at: '2026-10-16T08:01:00Z',
          updated_at: '2026-10-16T08:01:00Z',
          echo: false,
        },
      });
    }
    return answer(404, {});
  };
  api.expireTokens = () => api.valid.clear();
  api.value = (dsn, name) =>
    api.properties[dsn].find((x) => x.property.name === name)?.property.value;
  api.datapoints = () =>
    api.requests
      .filter((r) => r.method === 'POST' && r.path.endsWith('/datapoints.json'))
      .map((r) => [r.path.split('/')[5], r.body.datapoint.value]);
  return api;
}

/**
 * An Airstage Wi-Fi adapter on 127.0.0.1: GetParam / SetParam, NG 0002 when
 * a header name is not written as the app writes it or the device id is not
 * its own, at most 20 names per GetParam.
 */
export async function startFakeAdapter({ id, state }) {
  const adapter = {
    id,
    state: { iu_model: 'ASYG09KMTB', ...state },
    requests: [],
    /** Set to true to drop the next connection without answering. */
    dropNext: false,
  };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (adapter.dropNext) {
        adapter.dropNext = false;
        req.socket.destroy();
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        // answered NG below
      }
      const names = req.rawHeaders.filter((_, i) => i % 2 === 0);
      adapter.requests.push({ path: req.url, method: req.method, headers: names, body });
      const send = (json) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (!names.includes('Content-Type') || !body || body.device_id !== adapter.id) {
        send({ result: 'NG', error: '0002' });
        return;
      }
      if (req.url === '/GetParam' && body.set_level === '03' && Array.isArray(body.list)) {
        if (body.list.length > 20) {
          send({ result: 'NG', error: '0003' });
          return;
        }
        send({
          result: 'OK',
          value: Object.fromEntries(body.list.map((n) => [n, adapter.state[n] ?? '65535'])),
        });
        return;
      }
      if (req.url === '/SetParam' && body.set_level === '02' && body.value) {
        Object.assign(adapter.state, body.value);
        send({ result: 'OK', value: body.value });
        return;
      }
      send({ result: 'NG', error: '0001' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  adapter.port = server.address().port;
  adapter.address = `127.0.0.1:${adapter.port}`;
  adapter.close = () => new Promise((resolve) => server.close(resolve));
  /** The adapter goes away (the port is closed, connections are refused). */
  adapter.stop = adapter.close;
  return adapter;
}

/** An in-memory fs for src/storage.js. */
export function createMemoryFs(files = {}) {
  const fs = {
    files: { ...files },
    writes: 0,
    failWrites: false,
    async readFile(path) {
      if (!(path in fs.files)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return fs.files[path];
    },
    async writeFile(path, text) {
      if (fs.failWrites) {
        throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
      }
      fs.writes += 1;
      fs.files[path] = text;
    },
  };
  return fs;
}

/** Deterministic random bytes: n bytes of 0xab. */
export const fixedRandom = (n) => Buffer.alloc(n, 0xab);

/** Timers run by hand: setTimeout/setInterval are recorded, fire() runs the due ones. */
export function createManualTimers() {
  let id = 0;
  const timers = {
    pending: new Map(),
    setTimeout(fn, delay) {
      id += 1;
      timers.pending.set(id, { fn, delay, repeat: false });
      return id;
    },
    clearTimeout(handle) {
      timers.pending.delete(handle);
    },
    setInterval(fn, delay) {
      id += 1;
      timers.pending.set(id, { fn, delay, repeat: true });
      return id;
    },
    clearInterval(handle) {
      timers.pending.delete(handle);
    },
    /** The delays of the pending one-shot timers. */
    delays() {
      return [...timers.pending.values()].filter((t) => !t.repeat).map((t) => t.delay);
    },
    /** Runs the one-shot timers whose delay matches (all of them by default). */
    async fire(match = () => true) {
      const due = [...timers.pending.entries()].filter(([, t]) => !t.repeat && match(t.delay));
      for (const [handle, t] of due) {
        timers.pending.delete(handle);
        t.fn();
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      return due.length;
    },
  };
  return timers;
}

/** Waits until `check` is true (real time, for the loopback servers). */
export async function until(check, timeout = 2000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
