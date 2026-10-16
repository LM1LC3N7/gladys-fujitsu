// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// Three sources of units, each optional: the Airstage cloud account, the
// Airstage Wi-Fi adapters reached on the LAN (a list of "address MAC name"
// entries) and the FGLair cloud account. GLADYS_PREFER_LOCAL is the core's
// "Prefer the local connection" toggle (manifest transports local + cloud).
// -----------------------------------------------------------------------------

import { AIRSTAGE_HOSTS, FGLAIR_REGIONS, LIMITS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  airstage_email: '',
  airstage_password: '',
  airstage_region: 'eu',
  airstage_country: 'France',
  airstage_local_units: '',
  fglair_email: '',
  fglair_password: '',
  fglair_region: 'eu',
  language: 'fr',
};

export const LANGUAGES = ['en', 'fr'];
export const AIRSTAGE_REGIONS = Object.keys(AIRSTAGE_HOSTS);
export const FGLAIR_REGION_KEYS = Object.keys(FGLAIR_REGIONS);

const MAC = /^(?:[0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/;
const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?$/i;
const URL_LIKE = /^https?:\/\/[^\s/]+\/?$/i;

/** "e8:fb:1c-12 3456" -> "E8FB1C123456": the device id of the adapter API and of the cloud. */
export const macToId = (mac) => mac.replace(/[^0-9a-f]/gi, '').toUpperCase();

/**
 * One entry of the local list: an address (IPv4, host name with a dot, or
 * http(s)://address), the MAC address of the adapter, then an optional name.
 * @returns {{ host: string, port: number | null, scheme: 'http' | 'https' | null,
 *   id: string, name: string | null } | null}
 */
export function parseLocalEntry(text) {
  let address = null;
  let id = null;
  const name = [];
  for (const token of String(text).trim().split(/\s+/).filter(Boolean)) {
    if (!id && MAC.test(token)) {
      id = macToId(token);
    } else if (!address && (URL_LIKE.test(token) || IPV4.test(token) || HOSTNAME.test(token))) {
      address = token;
    } else {
      name.push(token);
    }
  }
  if (!address || !id) {
    return null;
  }
  let scheme = null;
  let rest = address;
  const match = /^(https?):\/\/([^/]+)\/?$/i.exec(address);
  if (match) {
    scheme = match[1].toLowerCase();
    rest = match[2];
  }
  const [host, port] = rest.split(':');
  return {
    host: host.toLowerCase(),
    port: port ? Number(port) : null,
    scheme,
    id,
    name: name.length > 0 ? name.join(' ').slice(0, 100) : null,
  };
}

/** The local list: entries separated by commas, semicolons or new lines. */
export function parseLocalUnits(text) {
  const units = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of String(text ?? '')
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter(Boolean)) {
    const unit = parseLocalEntry(entry);
    if (!unit) {
      invalid.push(entry.slice(0, 60));
    } else if (!seen.has(unit.id) && units.length < LIMITS.localUnits) {
      seen.add(unit.id);
      units.push(unit);
    }
  }
  return { units, invalid };
}

/**
 * @returns {{
 *   airstage: { email: string, password: string, region: string, country: string } | null,
 *   local: object[], localInvalid: string[],
 *   fglair: { email: string, password: string, region: string } | null,
 *   language: 'en' | 'fr', preferLocal: boolean,
 *   missing: string[], incomplete: string[] }}
 * `missing` is ['account'] while no source is configured; `incomplete` lists
 * the half-filled accounts (an e-mail without a password…).
 */
export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const text = (key) => String(c[key] ?? '').trim();
  const incomplete = [];

  const account = (prefix, regions, defaultRegion) => {
    const email = text(`${prefix}_email`);
    const password = String(c[`${prefix}_password`] ?? '');
    if (email === '' && password === '') {
      return null;
    }
    if (email === '' || password === '') {
      incomplete.push(prefix);
      return null;
    }
    const region = regions.includes(c[`${prefix}_region`]) ? c[`${prefix}_region`] : defaultRegion;
    return { email, password, region };
  };

  const airstageAccount = account('airstage', AIRSTAGE_REGIONS, DEFAULTS.airstage_region);
  const airstage = airstageAccount
    ? { ...airstageAccount, country: text('airstage_country') || DEFAULTS.airstage_country }
    : null;
  const fglair = account('fglair', FGLAIR_REGION_KEYS, DEFAULTS.fglair_region);
  const { units: local, invalid: localInvalid } = parseLocalUnits(c.airstage_local_units);
  const language = LANGUAGES.includes(c.language) ? c.language : DEFAULTS.language;
  const missing = !airstage && !fglair && local.length === 0 ? ['account'] : [];
  return {
    airstage,
    local,
    localInvalid,
    fglair,
    language,
    preferLocal: c.GLADYS_PREFER_LOCAL !== false,
    missing,
    incomplete,
  };
}
