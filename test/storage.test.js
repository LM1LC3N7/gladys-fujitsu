// -----------------------------------------------------------------------------
// What is kept in /data: ids, sessions tied to the credentials, adapter schemes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Storage } from '../src/storage.js';
import { AIRSTAGE_ACCOUNT, createMemoryFs, fixedRandom } from './helpers/fakes.js';

const FILE = '/data/fujitsu.json';
const SESSION = { accessToken: 'a', refreshToken: 'r', expiresAt: 123 };

test('ids generated once, kept across restarts', async () => {
  const fs = createMemoryFs();
  const storage = new Storage({ fs, randomBytes: fixedRandom });
  const token = await storage.deviceToken();
  assert.match(token, /^[0-9a-f]{22}:[0-9a-f]{140}$/);
  const saved = JSON.parse(fs.files[FILE]);
  assert.equal(saved.install_id, 'abababababababab');
  const again = new Storage({ fs, randomBytes: () => Buffer.alloc(80, 1) });
  assert.equal(await again.deviceToken(), token);
  assert.equal(fs.writes, 1);
});

test('a session is kept for the same account only, never the password', async () => {
  const fs = createMemoryFs();
  const storage = new Storage({ fs, randomBytes: fixedRandom });
  await storage.setSession('airstage', AIRSTAGE_ACCOUNT, SESSION);
  assert.deepEqual(await storage.session('airstage', AIRSTAGE_ACCOUNT), SESSION);
  assert.equal(await storage.session('fglair', AIRSTAGE_ACCOUNT), null);
  assert.equal(await storage.session('airstage', { ...AIRSTAGE_ACCOUNT, password: 'x' }), null);
  assert.equal(await storage.session('airstage', { ...AIRSTAGE_ACCOUNT, region: 'us' }), null);
  assert.ok(!fs.files[FILE].includes(AIRSTAGE_ACCOUNT.password));
  assert.ok(!fs.files[FILE].includes(AIRSTAGE_ACCOUNT.email));
  await storage.setSession('airstage', AIRSTAGE_ACCOUNT, null);
  assert.equal(await storage.session('airstage', AIRSTAGE_ACCOUNT), null);
});

test('the scheme of each adapter', async () => {
  const fs = createMemoryFs();
  const storage = new Storage({ fs, randomBytes: fixedRandom });
  assert.equal(await storage.localScheme('E8FB1C123456'), null);
  await storage.setLocalScheme('E8FB1C123456', 'https');
  const writes = fs.writes;
  await storage.setLocalScheme('E8FB1C123456', 'https');
  assert.equal(fs.writes, writes, 'unchanged: not written again');
  const again = new Storage({ fs, randomBytes: fixedRandom });
  assert.equal(await again.localScheme('E8FB1C123456'), 'https');
});

test('an unreadable file, a read-only /data', async () => {
  const fs = createMemoryFs({ [FILE]: '{not json' });
  fs.failWrites = true;
  const warnings = [];
  const storage = new Storage({
    fs,
    randomBytes: fixedRandom,
    logger: { warn: (m) => warnings.push(m) },
  });
  await storage.setSession('fglair', AIRSTAGE_ACCOUNT, SESSION);
  assert.deepEqual(await storage.session('fglair', AIRSTAGE_ACCOUNT), SESSION, 'kept in memory');
  assert.match(warnings[0], /EROFS/);
});
