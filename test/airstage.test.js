// -----------------------------------------------------------------------------
// The Airstage cloud client against the fake cloud: sign-in, refresh, device
// list, commands and their status, error kinds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRSTAGE_USER_AGENT, AirstageCloud } from '../src/airstage.js';
import { FujitsuAuthError, FujitsuError, FujitsuRateLimited } from '../src/http.js';
import { AIRSTAGE_ACCOUNT, createFakeAirstage } from './helpers/fakes.js';

const TOKEN = `${'ab'.repeat(11)}:${'cd'.repeat(70)}`;

function client(api, extra = {}) {
  const sessions = [];
  const c = new AirstageCloud({
    account: AIRSTAGE_ACCOUNT,
    deviceToken: TOKEN,
    transport: api.transport,
    onSession: (s) => sessions.push(s),
    ...extra,
  });
  return { c, sessions };
}

test('sign-in as the app does, then the device list', async () => {
  const api = createFakeAirstage();
  const { c, sessions } = client(api, { now: () => 1_000_000 });
  const devices = await c.listDevices();
  const [signIn, list] = api.requests;
  assert.equal(signIn.host, 'bke.euro.airstagelight.com');
  assert.equal(signIn.path, '/apiv1/users/sign_in');
  assert.equal(signIn.headers['User-Agent'], AIRSTAGE_USER_AGENT);
  assert.equal(signIn.headers.Authorization, undefined);
  assert.equal(signIn.headers['accept-encoding'], undefined, 'never a compressed answer');
  const { user } = signIn.body;
  assert.deepEqual(
    { ...user, ssid: typeof user.ssid },
    {
      country: 'France',
      deviceToken: TOKEN,
      email: 'jean@example.com',
      language: 'en',
      osVersion: 'iOS 17.4.1',
      password: 'secret-airstage',
      ssid: 'string',
    },
  );
  assert.match(user.ssid, /^[0-9a-f-]{36}$/);
  assert.equal(list.path, '/apiv1/devices/all');
  assert.deepEqual(list.query, { limit: '50' });
  assert.equal(list.headers.Authorization, 'Bearer as-token-1');
  assert.deepEqual(sessions, [
    { accessToken: 'as-token-1', refreshToken: 'as-refresh-1', expiresAt: 1_000_000 + 3_600_000 },
  ]);
  assert.deepEqual(
    devices.map((d) => [d.id, d.name, d.online, d.model]),
    [
      ['E8FB1C123456', 'Salon', true, 'ASYG09KMTB'],
      ['E8FB1C654321', 'Chambre', true, 'ASYG12KETA'],
      ['E8FB1CABCDEF', 'Bureau', false, 'ASYG07KMCC'],
    ],
  );
  assert.equal(devices[0].params.iu_set_tmp, '215');
});

test('the US region', async () => {
  const api = createFakeAirstage();
  const { c } = client(api, { account: { ...AIRSTAGE_ACCOUNT, region: 'us' } });
  await c.signIn();
  assert.equal(api.requests[0].host, 'bke.us.airstagelight.com');
});

test('a kept session is used, refreshed when refused, signed in again when the refresh fails', async () => {
  const api = createFakeAirstage();
  const first = client(api);
  await first.c.signIn();
  const kept = first.sessions[0];
  // A new start with the kept session: no sign-in.
  const { c, sessions } = client(api, { session: kept });
  await c.listDevices();
  assert.deepEqual(Object.keys(api.counts()), [
    'POST /apiv1/users/sign_in',
    'GET /apiv1/devices/all',
  ]);
  // The cloud forgets the token: refresh, then the call again.
  api.expireTokens();
  await c.listDevices();
  assert.equal(api.counts()['POST /apiv1/users/me/refresh_token'], 1);
  assert.equal(sessions.at(-1).accessToken, 'as-token-2');
  // The refresh token is refused too: a new sign-in.
  api.expireTokens();
  api.refresh.clear();
  await c.listDevices();
  assert.equal(api.counts()['POST /apiv1/users/sign_in'], 2);
});

test('an expired session is refreshed before the call', async () => {
  const api = createFakeAirstage();
  let now = 0;
  const { c } = client(api, { now: () => now });
  await c.signIn();
  now = 3_600_000;
  await c.listDevices();
  assert.deepEqual(
    api.requests.map((r) => r.path),
    ['/apiv1/users/sign_in', '/apiv1/users/me/refresh_token', '/apiv1/devices/all'],
  );
});

test('a refused password', async () => {
  const api = createFakeAirstage();
  const { c, sessions } = client(api, { account: { ...AIRSTAGE_ACCOUNT, password: 'wrong' } });
  await assert.rejects(c.listDevices(), FujitsuAuthError);
  assert.deepEqual(sessions, [null], 'the kept session is dropped');
  const err = await c.signIn().catch((e) => e);
  assert.ok(!err.message.includes('wrong'), 'never the password in a message');
});

test('HTTP 429 and other errors', async () => {
  const api = createFakeAirstage();
  const { c } = client(api, { now: () => 0 });
  api.next.push(() => ({ status: 429, headers: { 'retry-after': '120' }, body: '' }));
  const err = await c.signIn().catch((e) => e);
  assert.ok(err instanceof FujitsuRateLimited);
  assert.equal(err.retryAfter, 120_000);
  api.next.push(500);
  await assert.rejects(c.signIn(), /HTTP 500/);
  await c.signIn();
  api.next.push(() => ({ status: 200, headers: {}, body: '<html>' }));
  await assert.rejects(c.listDevices(), FujitsuError);
});

test('a command: the request, then its status', async () => {
  const api = createFakeAirstage();
  const { c } = client(api);
  const reqId = await c.setParameters('E8FB1C123456', { iu_onoff: '0', iu_set_tmp: '200' });
  assert.equal(reqId, 'req-1');
  const request = api.requests.at(-1);
  assert.equal(request.path, '/apiv1/devices/E8FB1C123456/set_parameters_request');
  assert.deepEqual(request.body, {
    deviceSubId: 0,
    parameters: [
      { name: 'iu_onoff', desiredValue: '0' },
      { name: 'iu_set_tmp', desiredValue: '200' },
    ],
  });
  assert.ok(request.timeout <= 4500, 'Gladys waits 5 s for a command');
  assert.deepEqual(await c.requestStatus('E8FB1C123456', reqId), {
    status: 'waiting',
    result: null,
    params: {},
  });
  const done = await c.requestStatus('E8FB1C123456', reqId);
  assert.equal(done.status, 'complete');
  assert.equal(done.result, 'success');
  assert.equal(done.params.iu_onoff, '0');
  api.next.push(() => ({ status: 200, headers: {}, body: '{}' }));
  await assert.rejects(c.setParameters('E8FB1C123456', { iu_onoff: '1' }), /not accepted/);
});
