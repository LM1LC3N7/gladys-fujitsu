// -----------------------------------------------------------------------------
// HTTP for the three clients: one exchange over bare node:http / node:https
// (only the headers given are sent, with their case: the Airstage adapters
// answer "NG 0002" to lowercase header names), the error kinds the app reacts
// to, and Retry-After.
// The password, the tokens and the headers are never logged nor put in an
// error message.
// -----------------------------------------------------------------------------

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export class FujitsuError extends Error {}
/** The service refused the e-mail or the password. Never retried on its own. */
export class FujitsuAuthError extends FujitsuError {}
/** HTTP 429: the service slows this client down. */
export class FujitsuRateLimited extends FujitsuError {
  constructor(message, retryAfter = null) {
    super(message);
    /** Milliseconds the server asked to wait, when it said. */
    this.retryAfter = retryAfter;
  }
}
/** The service or the adapter could not be reached, or did not answer in time. */
export class FujitsuConnectionError extends FujitsuError {
  constructor(message, code = null) {
    super(message);
    this.code = code;
  }
}
/** A command the unit cannot take: the message is shown to the user. */
export class UnsupportedError extends FujitsuError {}

export const clip = (text, length = 120) => String(text ?? '').slice(0, length);

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One HTTP exchange. Settles once: the size limit and the timeout reject
 * before the request is destroyed, and the late events of a destroyed
 * request are ignored.
 * @param {{ method: string, url: string, headers?: object, body?: string,
 *   timeout: number, limit: number, insecure?: boolean }} options insecure:
 *   accept the self-signed certificate of an adapter (HTTPS on an IP address)
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export function httpTransport({ method, url, headers = {}, body, timeout, limit, insecure }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    let settled = false;
    const settle = (err, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };
    const all = { ...headers };
    if (body !== undefined && !Object.keys(all).some((h) => h.toLowerCase() === 'content-length')) {
      all['Content-Length'] = String(Buffer.byteLength(body));
    }
    const https = target.protocol === 'https:';
    const send = https ? httpsRequest : httpRequest;
    const options = { method, headers: all };
    if (https && insecure) {
      options.rejectUnauthorized = false;
    }
    const failed = (err) =>
      settle(
        new FujitsuConnectionError(
          `${target.host}: ${clip(err.code ?? err.message, 80)}`,
          err.code ?? null,
        ),
      );
    const req = send(target, options, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          settle(new FujitsuError(`${target.host}: answer too big (over ${limit} bytes)`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(null, {
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', failed);
    });
    req.setTimeout(timeout, () => {
      settle(new FujitsuConnectionError(`${target.host}: timeout`, 'ETIMEDOUT'));
      req.destroy();
    });
    req.on('error', failed);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

/** Retry-After in seconds or as an HTTP date -> milliseconds, or null. */
export function retryAfterOf(value, now = Date.now()) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return null;
  }
  if (/^\d+$/.test(text)) {
    return Number(text) * 1000;
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/** The JSON of an answer, or null when it is empty or not JSON. */
export function jsonOf(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
