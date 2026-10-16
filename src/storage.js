// -----------------------------------------------------------------------------
// What this installation keeps in /data (the only writable place of the
// container), in fujitsu.json:
// - `install_id`: 16 hex characters generated at the first start, the key of
//   the HMACs below.
// - `device_token`: the push token the Airstage app sends when it signs in
//   (homebridge-fujitsu-airstage generates a random one of the same shape at
//   each sign-in); one per installation here, so the service sees one "phone".
// - `sessions.airstage`, `sessions.fglair`: the access and refresh tokens of
//   each cloud, so a restart does not sign in again. Tied to the credentials
//   by an HMAC (keyed by the install id) of the e-mail, the password and the
//   region: another account, password or region signs in again. The password
//   itself is never written.
// - `local`: the scheme (http or https) each adapter answered on, so the
//   probe is not repeated at every start.
// When /data cannot be written, the values live for this run only.
// -----------------------------------------------------------------------------

import { createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import { join } from 'node:path';

const FILE = 'fujitsu.json';
const INSTALL_ID = /^[0-9a-f]{16}$/;
const DEVICE_TOKEN = /^[0-9a-f]{22}:[0-9a-f]{140}$/;
const KINDS = ['airstage', 'fglair'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class Storage {
  constructor({ dir = '/data', fs = nodeFs, randomBytes = nodeRandomBytes, logger } = {}) {
    this.path = join(dir, FILE);
    this.dir = dir;
    this.fs = fs;
    this.randomBytes = randomBytes;
    this.logger = logger;
    this.data = null;
    this.writing = Promise.resolve();
  }

  async load() {
    if (this.data) {
      return this.data;
    }
    let saved = {};
    try {
      saved = JSON.parse(await this.fs.readFile(this.path, 'utf8'));
    } catch {
      // First start, or an unreadable file: new ids are generated.
    }
    if (!isObject(saved)) {
      saved = {};
    }
    const sessions = isObject(saved.sessions) ? saved.sessions : {};
    this.data = {
      install_id: INSTALL_ID.test(saved.install_id ?? '')
        ? saved.install_id
        : this.randomBytes(8).toString('hex'),
      device_token: DEVICE_TOKEN.test(saved.device_token ?? '')
        ? saved.device_token
        : `${this.randomBytes(11).toString('hex')}:${this.randomBytes(70).toString('hex')}`,
      sessions: Object.fromEntries(
        KINDS.map((kind) => [kind, isObject(sessions[kind]) ? sessions[kind] : null]),
      ),
      local: isObject(saved.local) ? saved.local : {},
    };
    if (
      this.data.install_id !== saved.install_id ||
      this.data.device_token !== saved.device_token
    ) {
      await this.save();
    }
    return this.data;
  }

  async deviceToken() {
    return (await this.load()).device_token;
  }

  /** The key a session is kept under: never the password itself. */
  credentialsKey(account) {
    return createHmac('sha256', this.data.install_id)
      .update(`${account.email}\u0000${account.password}\u0000${account.region}`)
      .digest('hex');
  }

  /** The session kept for this account, or null. */
  async session(kind, account) {
    const data = await this.load();
    const s = data.sessions[kind];
    if (!s || s.key !== this.credentialsKey(account) || typeof s.accessToken !== 'string') {
      return null;
    }
    return {
      accessToken: s.accessToken,
      refreshToken: typeof s.refreshToken === 'string' ? s.refreshToken : null,
      expiresAt: Number.isFinite(s.expiresAt) ? s.expiresAt : null,
    };
  }

  async setSession(kind, account, session) {
    const data = await this.load();
    data.sessions[kind] = session ? { key: this.credentialsKey(account), ...session } : null;
    await this.save();
  }

  /** The scheme an adapter answered on, or null. */
  async localScheme(id) {
    const scheme = (await this.load()).local[id];
    return scheme === 'http' || scheme === 'https' ? scheme : null;
  }

  async setLocalScheme(id, scheme) {
    const data = await this.load();
    if (data.local[id] === scheme) {
      return;
    }
    data.local[id] = scheme;
    await this.save();
  }

  /** Writes one after the other, so the last state wins. */
  save() {
    const text = `${JSON.stringify(this.data)}\n`;
    this.writing = this.writing.then(() =>
      this.fs.writeFile(this.path, text, { encoding: 'utf8', mode: 0o600 }).catch((err) => {
        this.logger?.warn?.(
          `Cannot keep the installation data in ${this.dir} (${err.code ?? err.message})`,
        );
      }),
    );
    return this.writing;
  }
}
