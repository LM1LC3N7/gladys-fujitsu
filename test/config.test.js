// -----------------------------------------------------------------------------
// The configuration normalized: the three sources, the list of adapters.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macToId, normalizeConfig, parseLocalEntry, parseLocalUnits } from '../src/config.js';

test('nothing configured', () => {
  assert.deepEqual(normalizeConfig(), {
    airstage: null,
    local: [],
    localInvalid: [],
    fglair: null,
    language: 'fr',
    preferLocal: true,
    missing: ['account'],
    incomplete: [],
  });
});

test('the accounts', () => {
  const config = normalizeConfig({
    airstage_email: '  jean@example.com ',
    airstage_password: ' p ',
    airstage_region: 'us',
    airstage_country: ' Belgium ',
    fglair_email: 'marie@example.com',
    fglair_password: 'q',
    fglair_region: 'mars',
    language: 'en',
    GLADYS_PREFER_LOCAL: false,
  });
  assert.deepEqual(config.airstage, {
    email: 'jean@example.com',
    password: ' p ',
    region: 'us',
    country: 'Belgium',
  });
  assert.deepEqual(config.fglair, { email: 'marie@example.com', password: 'q', region: 'eu' });
  assert.equal(config.language, 'en');
  assert.equal(config.preferLocal, false);
  assert.deepEqual(config.missing, []);
  assert.equal(
    normalizeConfig({ airstage_email: 'a', airstage_password: 'b' }).airstage.country,
    'France',
  );
});

test('a half-filled account is reported, not used', () => {
  const config = normalizeConfig({ airstage_email: 'jean@example.com', fglair_password: 'x' });
  assert.equal(config.airstage, null);
  assert.equal(config.fglair, null);
  assert.deepEqual(config.incomplete, ['airstage', 'fglair']);
  assert.deepEqual(config.missing, ['account']);
});

test('MAC addresses -> device ids', () => {
  assert.equal(macToId('e8:fb:1c:12:34:56'), 'E8FB1C123456');
  assert.equal(macToId('E8-FB-1C-12-34-56'), 'E8FB1C123456');
  assert.equal(macToId('e8fb1c123456'), 'E8FB1C123456');
});

test('one adapter entry: address, MAC, optional name, in any order', () => {
  assert.deepEqual(parseLocalEntry('192.168.1.20 E8:FB:1C:12:34:56 Salon'), {
    host: '192.168.1.20',
    port: null,
    scheme: null,
    id: 'E8FB1C123456',
    name: 'Salon',
  });
  assert.deepEqual(parseLocalEntry('Chambre des enfants e8fb1c654321 clim-chambre.lan'), {
    host: 'clim-chambre.lan',
    port: null,
    scheme: null,
    id: 'E8FB1C654321',
    name: 'Chambre des enfants',
  });
  assert.deepEqual(parseLocalEntry('https://192.168.1.21 E8-FB-1C-AB-CD-EF'), {
    host: '192.168.1.21',
    port: null,
    scheme: 'https',
    id: 'E8FB1CABCDEF',
    name: null,
  });
  assert.equal(parseLocalEntry('192.168.1.22:8080 E8FB1CABCDEF').port, 8080);
  assert.equal(parseLocalEntry('192.168.1.20'), null, 'no MAC');
  assert.equal(parseLocalEntry('E8:FB:1C:12:34:56 Salon'), null, 'no address');
});

test('the adapter list: commas, semicolons, new lines; duplicates and junk', () => {
  const { units, invalid } = parseLocalUnits(
    '192.168.1.20 E8:FB:1C:12:34:56 Salon, 192.168.1.21 E8FB1C654321;\n' +
      '192.168.1.99 e8:fb:1c:12:34:56 Again,  , nonsense',
  );
  assert.deepEqual(
    units.map((u) => [u.host, u.id, u.name]),
    [
      ['192.168.1.20', 'E8FB1C123456', 'Salon'],
      ['192.168.1.21', 'E8FB1C654321', null],
    ],
  );
  assert.deepEqual(invalid, ['nonsense']);
  const config = normalizeConfig({ airstage_local_units: '10.0.0.5 A0B1C2D3E4F5' });
  assert.equal(config.local.length, 1);
  assert.deepEqual(config.missing, [], 'an adapter alone is a configuration');
});
