// -----------------------------------------------------------------------------
// The FGLair (Ayla) client against the fake cloud: sign-in with the app id of
// the region, auth_token, device list, properties, datapoints.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FglairCloud } from '../src/fglair.js';
import { FujitsuAuthError, FujitsuError, FujitsuRateLimited } from '../src/http.js';
import { FGLAIR_ACCOUNT, createFakeFglair } from './helpers/fakes.js';

function client(api, extra = {}) {
  const sessions = [];
  const c = new FglairCloud({
    account: FGLAIR_ACCOUNT,
    transport: api.transport,
    onSession: (s) => sessions.push(s),
    ...extra,
  });
  return { c, sessions };
}

test('sign-in with the FGLair application of the region, then the Fujitsu units', async () => {
  const api = createFakeFglair();
  const { c, sessions } = client(api, { now: () => 0 });
  const devices = await c.listDevices();
  const [signIn, list] = api.requests;
  assert.equal(signIn.host, 'user-field-eu.aylanetworks.com');
  assert.equal(signIn.path, '/users/sign_in.json');
  assert.deepEqual(signIn.body, {
    user: {
      email: 'marie@example.com',
      password: 'secret-fglair',
      application: { app_id: 'FGLair-eu-id', app_secret: 'FGLair-eu-gpFbVBRoiJ8E3QWJ-QRULLL3j3U' },
    },
  });
  assert.equal(list.host, 'ads-eu.aylanetworks.com');
  assert.equal(list.path, '/apiv1/devices.json');
  assert.equal(list.headers.Authorization, 'auth_token ay-token-1');
  assert.deepEqual(sessions, [
    { accessToken: 'ay-token-1', refreshToken: 'ay-refresh-1', expiresAt: 86_400_000 },
  ]);
  assert.deepEqual(
    devices.map((d) => [d.id, d.modelType, d.online, d.model]),
    [
      ['AC000W000000001', 'A', true, 'AP-WA2E'],
      ['AC000W000000002', 'B', true, 'AP-WB1E'],
      ['AC000W000000003', 'F', false, 'AP-WF1E'],
    ],
    'the vacuum of the same Ayla account is left out',
  );
});

test('the other regions use the default application and hosts', async () => {
  const api = createFakeFglair();
  const { c } = client(api, { account: { ...FGLAIR_ACCOUNT, region: 'default' } });
  await assert.rejects(c.signIn(), FujitsuError);
  assert.equal(api.requests[0].host, 'user-field.aylanetworks.com');
  assert.equal(api.requests[0].body.user.application.app_id, 'CJIOSP-id');
});

test('properties and datapoints', async () => {
  const api = createFakeFglair();
  const { c } = client(api);
  const { props, meta } = await c.properties('AC000W000000001');
  assert.equal(props.adjust_temperature, 230);
  assert.equal(props.device_name, 'Séjour');
  assert.equal(meta.refresh.readOnly, false);
  await c.setProperty('AC000W000000001', 'adjust_temperature', 215);
  const post = api.requests.at(-1);
  assert.equal(
    post.path,
    '/apiv1/dsns/AC000W000000001/properties/adjust_temperature/datapoints.json',
  );
  assert.deepEqual(post.body, { datapoint: { value: 215 } });
  assert.equal(post.headers['x-ayla-source'], 'Mobile');
  assert.ok(post.timeout <= 4500);
  assert.equal(api.value('AC000W000000001', 'adjust_temperature'), 215);
  await c.requestRefresh('AC000W000000001', meta);
  assert.deepEqual(api.datapoints().at(-1), ['refresh', 1]);
});

test('an expired token is renewed with the refresh token', async () => {
  const api = createFakeFglair();
  const { c } = client(api);
  await c.listDevices();
  api.expireTokens();
  await c.listDevices();
  assert.equal(api.counts()['POST /users/refresh_token.json'], 1);
  assert.equal(api.counts()['POST /users/sign_in.json'], 1);
});

test('a refused password, a rate limit', async () => {
  const api = createFakeFglair();
  const { c, sessions } = client(api, { account: { ...FGLAIR_ACCOUNT, password: 'nope' } });
  await assert.rejects(c.listDevices(), FujitsuAuthError);
  assert.deepEqual(sessions, [null]);
  const ok = client(api).c;
  api.next.push(() => ({ status: 429, headers: {}, body: '' }));
  await assert.rejects(ok.signIn(), FujitsuRateLimited);
});
