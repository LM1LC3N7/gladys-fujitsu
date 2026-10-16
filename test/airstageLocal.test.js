// -----------------------------------------------------------------------------
// The adapter client against a fake adapter on the loopback (real HTTP, real
// node:http transport): request bodies, header case, NG answers, dropped
// connections, the HTTPS fallback.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AirstageLocal } from '../src/airstageLocal.js';
import { parseLocalEntry } from '../src/config.js';
import { FujitsuConnectionError, FujitsuError } from '../src/http.js';
import { startFakeAdapter } from './helpers/fakes.js';

const LOCAL = JSON.parse(
  readFileSync(new URL('./fixtures/airstage-local.json', import.meta.url), 'utf8'),
);
const ID = 'E8FB1C123456';
const noSleep = async () => {};

async function setup(t, extra = {}) {
  const adapter = await startFakeAdapter({ id: ID, state: LOCAL.state.value });
  t.after(() => adapter.close());
  const unit = parseLocalEntry(`${adapter.address} E8:FB:1C:12:34:56 Salon`);
  const client = new AirstageLocal({ unit, sleep: noSleep, ...extra });
  return { adapter, client, unit };
}

test('reads the model once, then the state in one request', async (t) => {
  const { adapter, client } = await setup(t);
  const params = await client.read();
  assert.equal(client.model, 'ASYG09KMTB');
  assert.equal(params.iu_set_tmp, '230');
  assert.equal(params.iu_economy, '1');
  await client.read();
  assert.equal(adapter.requests.length, 3);
  const [model, state] = adapter.requests;
  assert.equal(model.path, '/GetParam');
  assert.deepEqual(model.body, {
    device_id: ID,
    device_sub_id: 0,
    req_id: '',
    modified_by: '',
    set_level: '03',
    list: ['iu_model'],
  });
  assert.ok(state.body.list.length <= 20);
  assert.ok(!state.body.list.includes('iu_model'));
  for (const name of ['Content-Type', 'Content-Length', 'User-Agent']) {
    assert.ok(state.headers.includes(name), `${name} keeps its case`);
  }
});

test('sets parameters', async (t) => {
  const { adapter, client } = await setup(t);
  const answer = await client.set({ iu_onoff: '0' });
  assert.deepEqual(answer, { iu_onoff: '0' });
  const request = adapter.requests.at(-1);
  assert.equal(request.path, '/SetParam');
  assert.deepEqual(request.body, {
    device_id: ID,
    device_sub_id: 0,
    req_id: '',
    modified_by: '',
    set_level: '02',
    value: { iu_onoff: '0' },
  });
  assert.equal(adapter.state.iu_onoff, '0');
});

test('an NG answer (wrong MAC) is an error with the code', async (t) => {
  const adapter = await startFakeAdapter({ id: 'E8FB1C000000', state: {} });
  t.after(() => adapter.close());
  const client = new AirstageLocal({
    unit: parseLocalEntry(`${adapter.address} E8FB1C123456`),
    sleep: noSleep,
  });
  await assert.rejects(client.read(), /answered NG 0002/);
});

test('waits between two requests to the same adapter', async (t) => {
  const sleeps = [];
  let now = 100_000;
  const { client } = await setup(t, {
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    now: () => now,
  });
  await client.read();
  assert.deepEqual(sleeps, [1000], 'one pause between the model and the state');
  now += 5000;
  await client.read();
  assert.deepEqual(sleeps, [1000]);
});

test('a dropped connection is tried once more', async (t) => {
  const { adapter, client } = await setup(t);
  adapter.dropNext = true;
  const params = await client.read();
  assert.equal(params.iu_onoff, '1');
});

test('an adapter that is gone', async (t) => {
  const { adapter, client } = await setup(t);
  await adapter.stop();
  await assert.rejects(client.read(), FujitsuConnectionError);
});

test('HTTP refused: HTTPS, without checking the certificate, and remembered', async () => {
  const calls = [];
  const schemes = [];
  const transport = async ({ url, insecure }) => {
    calls.push([url, insecure]);
    if (url.startsWith('http:')) {
      throw new FujitsuConnectionError('refused', 'ECONNREFUSED');
    }
    return { status: 200, headers: {}, body: JSON.stringify(LOCAL.model) };
  };
  const unit = parseLocalEntry('192.168.1.20 E8FB1C123456');
  const client = new AirstageLocal({
    unit,
    transport,
    sleep: noSleep,
    onScheme: (s) => schemes.push(s),
  });
  await client.read().catch(() => {});
  assert.deepEqual(calls[0], ['http://192.168.1.20/GetParam', false]);
  assert.deepEqual(calls[1], ['https://192.168.1.20/GetParam', true]);
  assert.deepEqual(schemes, ['https']);
  assert.equal(client.scheme, 'https');
  // A scheme forced in the configuration is never changed.
  const forced = new AirstageLocal({
    unit: parseLocalEntry('http://192.168.1.20 E8FB1C123456'),
    transport,
    sleep: noSleep,
  });
  await assert.rejects(forced.read(), FujitsuConnectionError);
  // A scheme kept from a previous run.
  const kept = new AirstageLocal({ unit, scheme: 'https', transport, sleep: noSleep });
  assert.equal(kept.scheme, 'https');
});

test('an answer that is not JSON', async () => {
  const client = new AirstageLocal({
    unit: parseLocalEntry('192.168.1.20 E8FB1C123456'),
    transport: async () => ({ status: 200, headers: {}, body: 'hello' }),
    sleep: noSleep,
  });
  await assert.rejects(
    client.read(),
    (err) => err instanceof FujitsuError && /not JSON/.test(err.message),
  );
});
