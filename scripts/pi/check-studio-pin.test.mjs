import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { STAGE_13, checkPin, readPin } from './check-studio-pin.mjs';

const BODY = Buffer.from('not really a zip, but bytes are bytes');
const GOOD = createHash('sha256').update(BODY).digest('hex');

/** @param {string} sha @param {string} [version] */
function stage(sha, version = '9.9.9-aitool.1') {
  const dir = mkdtempSync(path.join(tmpdir(), 'pin-'));
  const file = path.join(dir, '13.sh');
  writeFileSync(
    file,
    `# comment PINNED_SHA256=ignored\nPINNED_VERSION=${version}\nPINNED_SHA256=${sha}\nMODULE_ID=x\nRELEASE_BASE=https://example.invalid/releases/download\n`
  );
  return { dir, file };
}

/** A release host that serves BODY at /<version>/module.zip and 404 elsewhere. */
async function host() {
  const server = createServer((req, res) => {
    if (req.url === '/9.9.9-aitool.1/module.zip') res.end(BODY);
    else {
      res.statusCode = 404;
      res.end('no');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test('the real stage 13 has a readable pin', () => {
  const pin = readPin(readFileSync(STAGE_13, 'utf8'));
  assert.ok(!('error' in pin), JSON.stringify(pin));
  assert.match(pin.version, /^\d+\.\d+\.\d+-aitool\.\d+$/);
  assert.ok(pin.sha256 === 'PENDING-RELEASE' || /^[0-9a-f]{64}$/.test(pin.sha256));
  assert.match(pin.base, /^https:\/\//);
});

test('a matching checksum passes, a typo is a mismatch, a missing release is a download failure', async () => {
  const h = await host();
  const logs = [];
  const log = s => logs.push(s);
  try {
    const ok = stage(GOOD);
    assert.equal(await checkPin({ stage: ok.file, base: h.base, log }), 0);
    assert.match(logs.at(-1), /OK 9\.9\.9-aitool\.1/);
    rmSync(ok.dir, { recursive: true });

    const typo = stage(GOOD.slice(0, -1) + (GOOD.endsWith('0') ? '1' : '0'));
    assert.equal(await checkPin({ stage: typo.file, base: h.base, log }), 1);
    assert.match(logs.at(-1), /MISMATCH/);
    assert.ok(logs.at(-1).includes(GOOD));
    rmSync(typo.dir, { recursive: true });

    const gone = stage(GOOD, '1.0.0-aitool.1');
    assert.equal(await checkPin({ stage: gone.file, base: h.base, log }), 3);
    assert.match(logs.at(-1), /answered 404/);
    rmSync(gone.dir, { recursive: true });
  } finally {
    h.close();
  }
});

test('PENDING-RELEASE is skipped, an unreadable pin is exit 2, an unreachable host is exit 3', async () => {
  const logs = [];
  const log = s => logs.push(s);
  const pending = stage('PENDING-RELEASE');
  assert.equal(await checkPin({ stage: pending.file, log }), 0);
  assert.match(logs.at(-1), /PENDING-RELEASE/);
  rmSync(pending.dir, { recursive: true });

  const bad = stage('xyz');
  assert.equal(await checkPin({ stage: bad.file, log }), 2);
  rmSync(bad.dir, { recursive: true });

  const empty = mkdtempSync(path.join(tmpdir(), 'pin-'));
  const file = path.join(empty, '13.sh');
  writeFileSync(file, '# nothing here\n');
  assert.equal(await checkPin({ stage: file, log }), 2);
  rmSync(empty, { recursive: true });

  const down = stage(GOOD);
  assert.equal(await checkPin({ stage: down.file, base: 'http://127.0.0.1:1', log }), 3);
  assert.match(logs.at(-1), /could not download/);
  rmSync(down.dir, { recursive: true });
});
