// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIRSTAGE_REGIONS, DEFAULTS, FGLAIR_REGION_KEYS, LANGUAGES } from '../src/config.js';
import { ACTIONS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-fujitsu:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-fujitsu/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.categories, ['climate']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || value !== '') {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  for (const key of ['airstage_password', 'fglair_password']) {
    assert.equal(fields[key].type, 'secret', key);
  }
  for (const field of manifest.config_schema) {
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.type === 'section') {
      for (const lang of ['en', 'fr']) {
        assert.ok(field.description[lang].length <= 1000, `${field.key}.${lang} over 1000`);
      }
    } else {
      assert.ok(field.key in DEFAULTS, `${field.key} is not read by the code`);
      assert.equal(field.required, false, `${field.key}: every source is optional`);
    }
  }
  assert.deepEqual(fields.language.options.map((o) => o.value).sort(), [...LANGUAGES].sort());
  assert.deepEqual(
    fields.airstage_region.options.map((o) => o.value),
    AIRSTAGE_REGIONS,
  );
  assert.deepEqual(
    fields.fglair_region.options.map((o) => o.value),
    FGLAIR_REGION_KEYS,
  );
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  assert.match(intro.description.en, /Airstage/);
  assert.match(intro.description.en, /FGLair/);
  assert.match(intro.description.en, /Overkiz/);
  assert.match(intro.description.en, /Unofficial, not affiliated with Fujitsu General/);
  assert.match(intro.description.fr, /Non officiel, sans lien avec Fujitsu General/);
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  const action = manifest.actions.find((a) => a.key === ACTIONS.TEST);
  assert.ok(action.timeout_seconds >= 30 && action.timeout_seconds <= 120);
});
