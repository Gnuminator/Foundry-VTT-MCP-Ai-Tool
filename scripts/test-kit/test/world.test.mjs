import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalProvision, provisionWorld } from '../lib/world.mjs';
import { EnvError } from '../lib/errors.mjs';

const win = { platform: 'win32' };

/** @param {string} url @param {{platform?: string}} [o] */
const refused = (url, o = win) =>
  assert.throws(
    () => assertLocalProvision(url, o),
    err => {
      assert.ok(err instanceof EnvError, url);
      assert.match(err.message, /passwordless GMs/, url);
      return true;
    },
    url
  );

test("provisioning is allowed on the PC's test Foundry, however loopback is spelled", () => {
  for (const url of [
    'http://127.0.0.1:30001',
    'http://localhost:30001',
    'http://LOCALHOST:30001',
    'http://[::1]:30001',
    'http://[0:0:0:0:0:0:0:1]:30001',
    'http://127.1:30001',
    'http://0x7f000001:30001',
    'http://evil.com@127.0.0.1:30001',
  ]) {
    assert.doesNotThrow(() => assertLocalProvision(url, win), url);
  }
});

test('provisioning a Foundry that is not on this machine is refused', () => {
  for (const url of [
    'http://foundry-pi:30000',
    'http://192.168.1.20:30001',
    'https://example.com',
    'http://127.0.0.1@evil.com:30001',
    'http://localhost.:30001',
    'http://127.0.0.2:30001',
    'http://[::ffff:127.0.0.1]:30001',
    'http://0.0.0.0:30001',
    'http://127.0.0.1.nip.io:30001',
    'http://127.0.0.1%2eevil.com:30001',
  ]) {
    refused(url);
  }
  assert.throws(() => assertLocalProvision('not a url', win), EnvError);
});

test('a loopback address that is not the test Foundry is refused (the Pi, an SSH forward)', () => {
  // The Pi's own Foundry port, which the tunnel serves; a forward to it on another local port.
  refused('http://127.0.0.1:30000');
  refused('http://localhost:30100');
  refused('https://127.0.0.1:30001');
  // The kit run on the Pi itself (or any Linux host) is not the PC's test server.
  refused('http://127.0.0.1:30001', { platform: 'linux' });
});

test('provisionWorld refuses a remote Foundry before it contacts it', async () => {
  await assert.rejects(
    provisionWorld({ foundryUrl: 'http://foundry-pi:30000', world: 'strahd-kit' }),
    /not the PC's test Foundry/
  );
});
