// -----------------------------------------------------------------------------
// The whole integration, wired like the container (src/handlers.js): the SDK's
// fake Gladys, the fake Airstage and FGLair clouds, fake Wi-Fi adapters on the
// loopback (real HTTP), the storage on an in-memory fs and timers run by hand.
// No network beyond 127.0.0.1.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AirstageCloud } from '../src/airstage.js';
import { AirstageLocal } from '../src/airstageLocal.js';
import { FujitsuApp } from '../src/app.js';
import { AC_MODE, AC_SWING_VERTICAL, TIMINGS } from '../src/constants.js';
import { FglairCloud } from '../src/fglair.js';
import { registerHandlers } from '../src/handlers.js';
import { Storage } from '../src/storage.js';
import {
  AIRSTAGE_ACCOUNT,
  FGLAIR_ACCOUNT,
  createFakeAirstage,
  createFakeFglair,
  createManualTimers,
  createMemoryFs,
  fixedRandom,
  startFakeAdapter,
} from './helpers/fakes.js';

const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
const LOCAL = JSON.parse(
  readFileSync(new URL('./fixtures/airstage-local.json', import.meta.url), 'utf8'),
);
const AIRSTAGE_CONFIG = {
  airstage_email: AIRSTAGE_ACCOUNT.email,
  airstage_password: AIRSTAGE_ACCOUNT.password,
  language: 'en',
};
const FGLAIR_CONFIG = {
  fglair_email: FGLAIR_ACCOUNT.email,
  fglair_password: FGLAIR_ACCOUNT.password,
  language: 'en',
};

async function setup(t, { config, fs = createMemoryFs() } = {}) {
  const airstage = createFakeAirstage();
  const fglair = createFakeFglair();
  const timers = createManualTimers();
  const gladys = createFakeGladys({ config });
  const storage = new Storage({ fs, randomBytes: fixedRandom });
  const app = new FujitsuApp({
    gladys,
    logger: silent,
    storage,
    timers,
    createAirstage: (o) => new AirstageCloud({ ...o, transport: airstage.transport }),
    createLocal: (o) => new AirstageLocal({ ...o, sleep: async () => {} }),
    createFglair: (o) => new FglairCloud({ ...o, transport: fglair.transport }),
  });
  registerHandlers(gladys, app, silent);
  t.after(() => app.stop());
  return { app, gladys, airstage, fglair, timers, fs };
}

async function adapterFor(t, id = 'E8FB1C123456', state = LOCAL.state.value) {
  const adapter = await startFakeAdapter({ id, state });
  t.after(() => adapter.close());
  return adapter;
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);
const featureOf = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
const lastTransport = (gladys, device) =>
  gladys.fake.transports.filter((x) => x.device_external_id === device.external_id).at(-1);
const status = (gladys) => gladys.fake.connectionStatus;
/** Runs the timers of that delay, then waits for the polls they started (real HTTP is involved). */
async function fireDelay(timers, delay, app) {
  await timers.fire((d) => d === delay);
  for (let i = 0; app && app.running.size > 0 && i < 200; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('Airstage cloud: the units in Discovery, their states once added, cloud badges', async (t) => {
  const { gladys, airstage, fs } = await setup(t, { config: AIRSTAGE_CONFIG });
  await gladys.connect();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Salon', 'Chambre', 'Bureau'],
  );
  assert.deepEqual(airstage.counts(), {
    'POST /apiv1/users/sign_in': 1,
    'GET /apiv1/devices/all': 1,
  });
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /Airstage cloud: 3 units\. Open Discovery/);
  assert.match(status(gladys).message.fr, /Cloud Airstage : 3 appareils/);
  assert.deepEqual(gladys.fake.states, [], 'no state for devices not added yet');

  const salon = deviceNamed(gladys, 'Salon');
  await gladys.fake.deviceCreated(salon);
  const id = salon.external_id;
  assert.equal(gladys.fake.lastState(`${id}:binary`), 1);
  assert.equal(gladys.fake.lastState(`${id}:mode`), AC_MODE.HEATING);
  assert.equal(gladys.fake.lastState(`${id}:target-temperature`), 21.5);
  assert.equal(gladys.fake.lastState(`${id}:swing-vertical`), AC_SWING_VERTICAL.POSITION_2);
  assert.equal(gladys.fake.lastState(`${id}:outdoor-temperature`), 8.5);
  assert.deepEqual(lastTransport(gladys, salon), { device_external_id: id, transport: 'cloud' });
  const office = deviceNamed(gladys, 'Bureau');
  await gladys.fake.deviceCreated(office);
  assert.equal(lastTransport(gladys, office).transport, 'unreachable', 'offline in the cloud');

  const kept = fs.files['/data/fujitsu.json'];
  assert.match(kept, /as-token-1/);
  assert.ok(!kept.includes(AIRSTAGE_ACCOUNT.password), 'never the password');
});

test('the cloud is polled every 2 minutes; a restart reuses the kept session', async (t) => {
  const fs = createMemoryFs();
  const first = await setup(t, { config: AIRSTAGE_CONFIG, fs });
  await first.gladys.connect();
  assert.ok(first.timers.delays().includes(TIMINGS.airstagePoll));
  await fireDelay(first.timers, TIMINGS.airstagePoll);
  assert.equal(first.airstage.counts()['GET /apiv1/devices/all'], 2);
  first.app.stop();

  const second = await setup(t, { config: AIRSTAGE_CONFIG, fs });
  second.airstage.valid.add('as-token-1');
  await second.gladys.connect();
  assert.equal(second.airstage.counts()['POST /apiv1/users/sign_in'], undefined, 'no new sign-in');
});

test('a command through the Airstage cloud, then the status of its request', async (t) => {
  const { gladys, airstage, timers } = await setup(t, { config: AIRSTAGE_CONFIG });
  await gladys.connect();
  const salon = deviceNamed(gladys, 'Salon');
  await gladys.fake.deviceCreated(salon);
  const ack = await gladys.fake.setValue(salon, featureOf(salon, 'mode'), AC_MODE.COOLING);
  assert.deepEqual(ack, { success: true });
  const set = airstage.requests.find((r) => r.path.endsWith('/set_parameters_request'));
  assert.deepEqual(set.body.parameters, [{ name: 'iu_op_mode', desiredValue: '1' }]);
  assert.equal(gladys.fake.lastState(`${salon.external_id}:mode`), AC_MODE.COOLING);
  // The request: waiting, then complete with the parameters of the unit.
  await fireDelay(timers, TIMINGS.requestStatusInterval);
  await fireDelay(timers, TIMINGS.requestStatusInterval);
  assert.equal(airstage.counts()['GET /apiv1/devices/E8FB1C123456/requests/req-1'], 2);

  const refused = await gladys.fake.setValue(salon, featureOf(salon, 'target-temperature'), 35);
  assert.equal(refused.success, false);
  assert.match(refused.error, /between 18 and 30/);
  const setpoint = await gladys.fake.setValue(salon, featureOf(salon, 'target-temperature'), 22.4);
  assert.equal(setpoint.success, true);
  assert.equal(airstage.param('E8FB1C123456', 'iu_set_tmp'), '225');
  assert.equal(gladys.fake.lastState(`${salon.external_id}:target-temperature`), 22.5);
});

test('adapter and cloud for the same unit: local first, the cloud when the adapter fails', async (t) => {
  const adapter = await adapterFor(t);
  const { app, gladys, airstage, timers } = await setup(t, {
    config: { ...AIRSTAGE_CONFIG, airstage_local_units: `${adapter.address} E8:FB:1C:12:34:56` },
  });
  await gladys.connect();
  assert.equal(gladys.fake.discoveredDevices.length, 3, 'one device per unit');
  const salon = deviceNamed(gladys, 'Salon');
  await gladys.fake.deviceCreated(salon);
  const id = salon.external_id;
  assert.deepEqual(lastTransport(gladys, salon), { device_external_id: id, transport: 'local' });
  assert.equal(gladys.fake.lastState(`${id}:mode`), AC_MODE.COOLING, 'the adapter reading');
  assert.equal(gladys.fake.lastState(`${id}:target-temperature`), 23);
  assert.match(status(gladys).message.en, /Airstage Wi-Fi adapters: 1 of 1 reachable/);

  // A command goes to the adapter, not to the cloud.
  const ack = await gladys.fake.setValue(salon, featureOf(salon, 'binary'), 0);
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(adapter.requests.at(-1).body.value, { iu_onoff: '0' });
  assert.equal(
    airstage.counts()['POST /apiv1/devices/E8FB1C123456/set_parameters_request'],
    undefined,
  );
  assert.equal(gladys.fake.lastState(`${id}:binary`), 0);
  // The cloud poll does not bring the cloud's older values back.
  await fireDelay(timers, TIMINGS.airstagePoll, app);
  assert.equal(gladys.fake.lastState(`${id}:binary`), 0);
  assert.equal(gladys.fake.lastState(`${id}:mode`), AC_MODE.COOLING);

  // The adapter goes away: after two failed reads, the cloud takes over.
  await adapter.stop();
  await fireDelay(timers, TIMINGS.localPoll, app);
  assert.equal(lastTransport(gladys, salon).transport, 'local', 'one failure is not enough');
  await fireDelay(timers, TIMINGS.localPoll, app);
  const badge = lastTransport(gladys, salon);
  assert.equal(badge.transport, 'cloud');
  assert.equal(badge.degraded, true);
  assert.match(badge.message.en, /Wi-Fi adapter unreachable/);
  assert.equal(gladys.fake.lastState(`${id}:mode`), AC_MODE.HEATING, 'the cloud reading');
  assert.match(status(gladys).message.en, /0 of 1 reachable/);
  await gladys.fake.setValue(salon, featureOf(salon, 'economy'), 1);
  assert.equal(airstage.param('E8FB1C123456', 'iu_economy'), '1', 'through the cloud now');

  // The user turns the local preference off: the cloud is the nominal way.
  await gladys.fake.configUpdated({ ...gladys.fake.config, GLADYS_PREFER_LOCAL: false });
  assert.deepEqual(lastTransport(gladys, salon), { device_external_id: id, transport: 'cloud' });
});

test('adapters only: no account, the name of the configuration, local badge', async (t) => {
  const adapter = await adapterFor(t, 'A0B1C2D3E4F5');
  const { gladys } = await setup(t, {
    config: { airstage_local_units: `${adapter.address} A0:B1:C2:D3:E4:F5 Séjour`, language: 'fr' },
  });
  await gladys.connect();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.name, d.model]),
    [['Séjour', 'fujitsu-airstage']],
  );
  const device = gladys.fake.discoveredDevices[0];
  assert.deepEqual(device.params, [
    { name: 'MAC_ADDRESS', value: 'A0:B1:C2:D3:E4:F5' },
    { name: 'MODEL', value: 'ASYG09KMTB' },
  ]);
  assert.equal(featureOf(device, 'binary').name, 'Marche/arrêt');
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Adaptateurs Wi-Fi Airstage : 1 sur 1 joignable/);
  await gladys.fake.deviceCreated(device);
  assert.equal(lastTransport(gladys, device).transport, 'local');
  const ack = await gladys.fake.setValue(
    device,
    featureOf(device, 'swing-vertical'),
    AC_SWING_VERTICAL.POSITION_3,
  );
  assert.equal(ack.success, true);
  assert.deepEqual(adapter.requests.at(-1).body.value, { iu_af_dir_vrt: '3' });
});

test('an adapter that does not answer at start: no device, not connected', async (t) => {
  const adapter = await adapterFor(t, 'A0B1C2D3E4F5');
  await adapter.stop();
  const { gladys, timers } = await setup(t, {
    config: { airstage_local_units: `${adapter.address} A0B1C2D3E4F5, nonsense` },
  });
  await gladys.connect();
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /Adapter entries not understood.*"nonsense"/);
  assert.match(status(gladys).message.en, /0 of 1 reachable/);
  assert.ok(timers.delays().includes(TIMINGS.localPoll));
});

test('FGLair: the units, their states, commands as datapoints', async (t) => {
  const { gladys, fglair, timers } = await setup(t, { config: FGLAIR_CONFIG });
  await gladys.connect();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.name, d.model]),
    [
      ['Séjour', 'fujitsu-fglair'],
      ['Chambre parents', 'fujitsu-fglair'],
    ],
    'the offline unit is not read, the vacuum is not a Fujitsu unit',
  );
  assert.deepEqual(fglair.datapoints(), [['refresh', 1]], 'only the A module measures the room');
  assert.match(status(gladys).message.en, /FGLair cloud: 3 units/);
  const living = deviceNamed(gladys, 'Séjour');
  await gladys.fake.deviceCreated(living);
  const id = living.external_id;
  assert.equal(gladys.fake.lastState(`${id}:mode`), AC_MODE.COOLING);
  assert.equal(gladys.fake.lastState(`${id}:indoor-temperature`), 22.5);
  assert.equal(gladys.fake.lastState(`${id}:outdoor-low-noise`), 1);
  assert.deepEqual(lastTransport(gladys, living), { device_external_id: id, transport: 'cloud' });

  await gladys.fake.setValue(living, featureOf(living, 'binary'), 0);
  await gladys.fake.setValue(living, featureOf(living, 'binary'), 1);
  await gladys.fake.setValue(living, featureOf(living, 'target-temperature'), 21.5);
  await gladys.fake.setValue(living, featureOf(living, 'economy'), 1);
  assert.deepEqual(fglair.datapoints().slice(1), [
    ['operation_mode', 0],
    ['operation_mode', 3],
    ['adjust_temperature', 215],
    ['economy_mode', 1],
  ]);
  assert.equal(gladys.fake.lastState(`${id}:economy`), 1);
  // The unit is read again a few seconds after a command.
  const reads = fglair.counts()['GET /apiv1/dsns/AC000W000000001/properties.json'];
  await fireDelay(timers, TIMINGS.afterCommand);
  assert.equal(fglair.counts()['GET /apiv1/dsns/AC000W000000001/properties.json'], reads + 1);
  assert.equal(gladys.fake.lastState(`${id}:target-temperature`), 21.5);

  const bedroom = deviceNamed(gladys, 'Chambre parents');
  const swing = await gladys.fake.setValue(bedroom, featureOf(bedroom, 'swing-vertical'), 0);
  assert.equal(swing.success, true);
  assert.deepEqual(fglair.datapoints().at(-1), ['af_vertical_move_step1', 0]);
  const quiet = await gladys.fake.setValue(bedroom, featureOf(bedroom, 'fan-speed'), 6);
  assert.match(quiet.error, /no fan speed Quiet/);
});

test('a refused password is not retried; the test button; saving starts again', async (t) => {
  const { gladys, airstage, timers } = await setup(t, {
    config: { ...AIRSTAGE_CONFIG, airstage_password: 'wrong' },
  });
  await gladys.connect();
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /Airstage cloud: the e-mail or the password was refused/);
  assert.deepEqual(timers.delays(), [], 'nothing scheduled: no retry');
  const test1 = await gladys.fake.action('test_connection', {});
  assert.match(test1.data.message.en, /Airstage cloud: the e-mail or the password was refused/);
  assert.equal(airstage.counts()['POST /apiv1/users/sign_in'], 2, 'the button is one more try');

  await gladys.fake.configUpdated(AIRSTAGE_CONFIG);
  assert.equal(status(gladys).connected, true);
  const test2 = await gladys.fake.action('test_connection', {});
  assert.match(
    test2.data.message.en,
    /Airstage cloud: sign-in OK, 3 units \("Salon", "Chambre", "Bureau"\)/,
  );
  assert.match(test2.data.message.fr, /connexion OK, 3 appareils/);
});

test('an unreachable cloud is retried with a growing delay', async (t) => {
  const { gladys, airstage, timers } = await setup(t, { config: AIRSTAGE_CONFIG });
  airstage.down = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
  await gladys.connect();
  assert.equal(status(gladys).connected, false);
  assert.match(
    status(gladys).message.en,
    /Airstage cloud: unreachable \(getaddrinfo ENOTFOUND\), next attempt in 5 s/,
  );
  assert.deepEqual(timers.delays(), [5000]);
  await timers.fire();
  assert.deepEqual(timers.delays(), [10000]);
  airstage.down = null;
  await timers.fire();
  assert.equal(status(gladys).connected, true);
  assert.deepEqual(timers.delays(), [TIMINGS.airstagePoll]);
});

test('a rate limit waits what the cloud says', async (t) => {
  const { gladys, fglair, timers } = await setup(t, { config: FGLAIR_CONFIG });
  fglair.next.push(() => ({ status: 429, headers: { 'retry-after': '900' }, body: '' }));
  await gladys.connect();
  assert.match(
    status(gladys).message.en,
    /FGLair cloud: too many requests, next attempt in 15 min/,
  );
  assert.deepEqual(timers.delays(), [900_000]);
});

test('every source at once, the test button reads each of them', async (t) => {
  const adapter = await adapterFor(t);
  const { gladys } = await setup(t, {
    config: {
      ...AIRSTAGE_CONFIG,
      ...FGLAIR_CONFIG,
      airstage_local_units: `${adapter.address} E8:FB:1C:12:34:56`,
    },
  });
  await gladys.connect();
  assert.equal(gladys.fake.discoveredDevices.length, 5);
  assert.match(
    status(gladys).message.en,
    /^Airstage cloud: 3 units\. FGLair cloud: 3 units\. Airstage Wi-Fi adapters: 1 of 1 reachable\. Open Discovery/,
  );
  const ack = await gladys.fake.action('test_connection', {});
  const message = ack.data.message.en;
  assert.match(message, /Airstage cloud: sign-in OK, 3 units/);
  assert.match(message, new RegExp(`Adapter ${adapter.address}: OK \\(ASYG09KMTB\\)`));
  assert.match(message, /FGLair cloud: sign-in OK, 3 units/);
});

test('nothing configured, a half-filled account', async (t) => {
  const { gladys } = await setup(t, { config: { fglair_email: 'marie@example.com' } });
  await gladys.connect();
  assert.equal(status(gladys).connected, false);
  assert.match(
    status(gladys).message.en,
    /^FGLair cloud: the e-mail or the password is missing\. Fill in/,
  );
  const ack = await gladys.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /^Fill in your Airstage or FGLair account/);
});

test('commands on unknown features or unreachable units fail with a message', async (t) => {
  const { gladys } = await setup(t, { config: AIRSTAGE_CONFIG });
  await gladys.connect();
  const office = deviceNamed(gladys, 'Bureau');
  const off = await gladys.fake.setValue(office, featureOf(office, 'binary'), 1);
  assert.match(off.error, /unreachable for now/);
  const unknown = await gladys.fake.setValue(
    office,
    { external_id: `${office.external_id}:nope` },
    1,
  );
  assert.match(unknown.error, /unknown Fujitsu feature/);
});

test('Gladys reconnects: devices, states and badges published again', async (t) => {
  const { app, gladys } = await setup(t, { config: AIRSTAGE_CONFIG });
  await gladys.connect();
  const salon = deviceNamed(gladys, 'Salon');
  await gladys.fake.deviceCreated(salon);
  const states = gladys.fake.states.length;
  const transports = gladys.fake.transports.length;
  await app.start(gladys.fake.config);
  assert.ok(gladys.fake.states.length > states, 'the states again');
  assert.ok(gladys.fake.transports.length > transports, 'the badges again');
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});
