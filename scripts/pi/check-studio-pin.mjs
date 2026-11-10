#!/usr/bin/env node
// Checks the Actor Studio pin of Pi stage 13 against the published release: downloads
// $RELEASE_BASE/$PINNED_VERSION/module.zip, hashes it and compares the sha256 with PINNED_SHA256, so a
// typo in a pin shows before the Pi run (stage 13 itself only notices on the Pi, before it changes anything).
// Read-only: nothing is written or sent anywhere except the one GET to the release host.
//
//   node scripts/pi/check-studio-pin.mjs                  (npm run studio:pin-check)
//   node scripts/pi/check-studio-pin.mjs --stage <file>   (another copy of stage 13, for tests)
//   node scripts/pi/check-studio-pin.mjs --base <url>     (another release host, for tests)
//
// Exit codes: 0 pin matches (or the pin is PENDING-RELEASE, which stage 13 refuses on its own),
// 1 the checksum differs, 2 the stage file has no readable pin, 3 the download failed (network, 404).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STAGE_13 = path.join(here, 'remote', '13-player-creation.sh');
/** The same cap as stage 13's MAX_ZIP_BYTES: a release far above it is not the module. */
const MAX_BYTES = 209715200;

/**
 * The three pin values of stage 13: plain NAME=value lines at the start of a line.
 * @param {string} text
 * @returns {{version: string, sha256: string, base: string} | {error: string}}
 */
export function readPin(text) {
  /** @param {string} name */
  const get = name => {
    const m = new RegExp(`^${name}=([^\\s#]+)`, 'm').exec(text);
    return m ? m[1] : '';
  };
  const version = get('PINNED_VERSION');
  const sha256 = get('PINNED_SHA256');
  const base = get('RELEASE_BASE');
  if (!version || !sha256 || !base) return { error: 'PINNED_VERSION, PINNED_SHA256 or RELEASE_BASE not found' };
  if (sha256 !== 'PENDING-RELEASE' && !/^[0-9a-f]{64}$/.test(sha256))
    return { error: `PINNED_SHA256 is not 64 lower-case hex characters: ${sha256}` };
  return { version, sha256, base };
}

/**
 * @param {{stage?: string, base?: string, fetchImpl?: typeof fetch, log?: (s: string) => void}} [opts]
 * @returns {Promise<number>} the exit code
 */
export async function checkPin(opts = {}) {
  const log = opts.log ?? (s => console.log(s));
  const pin = readPin(readFileSync(opts.stage ?? STAGE_13, 'utf8'));
  if ('error' in pin) {
    log(`studio pin check: ${pin.error}`);
    return 2;
  }
  if (pin.sha256 === 'PENDING-RELEASE') {
    log(`studio pin check: ${pin.version} is PENDING-RELEASE, nothing to compare (stage 13 refuses it on its own)`);
    return 0;
  }
  const url = `${opts.base ?? pin.base}/${pin.version}/module.zip`;
  let digest;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { redirect: 'follow' });
    if (!res.ok) {
      log(`studio pin check: ${url} answered ${res.status}`);
      return 3;
    }
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        log(`studio pin check: ${url} is larger than ${MAX_BYTES} bytes, not the module`);
        return 3;
      }
      hash.update(chunk);
    }
    digest = hash.digest('hex');
  } catch (e) {
    log(`studio pin check: could not download ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return 3;
  }
  if (digest === pin.sha256) {
    log(`studio pin check: OK ${pin.version} sha256 ${digest}`);
    return 0;
  }
  log(
    `studio pin check: MISMATCH for ${pin.version}\n  pinned    ${pin.sha256}\n  published ${digest}\n  from      ${url}\n` +
      'Fix PINNED_SHA256 in scripts/pi/remote/13-player-creation.sh (or the version) before the Pi run.'
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  /** @param {string} flag */
  const arg = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  checkPin({ stage: arg('--stage'), base: arg('--base') }).then(code => process.exit(code));
}
