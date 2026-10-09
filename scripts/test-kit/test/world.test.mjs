import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalProvision, provisionWorld } from '../lib/world.mjs';
import { EnvError } from '../lib/errors.mjs';

test('provisioning is allowed on loopback', () => {
  for (const url of ['http://127.0.0.1:30001', 'http://localhost:30001', 'http://[::1]:30001']) {
    assert.doesNotThrow(() => assertLocalProvision(url), url);
  }
});

test('provisioning a Foundry that is not on this machine is refused', () => {
  for (const url of [
    'http://foundry-pi:30000',
    'http://192.168.1.20:30000',
    'https://example.com',
  ]) {
    assert.throws(
      () => assertLocalProvision(url),
      err => {
        assert.ok(err instanceof EnvError, url);
        assert.match(err.message, /passwordless GMs/);
        return true;
      }
    );
  }
  assert.throws(() => assertLocalProvision('not a url'), EnvError);
});

test('allowRemote opts in explicitly', () => {
  assert.doesNotThrow(() => assertLocalProvision('http://foundry-pi:30000', { allowRemote: true }));
});

test('provisionWorld refuses a remote Foundry before it contacts it', async () => {
  await assert.rejects(
    provisionWorld({ foundryUrl: 'http://foundry-pi:30000', world: 'strahd-kit' }),
    /not on this machine/
  );
});
