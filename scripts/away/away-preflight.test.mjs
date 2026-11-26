// Tests for scripts/away/away-preflight*.ps1 (away-game-preflight). Needs PowerShell 7 (pwsh).
//   node --test scripts/away/away-preflight.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, 'away-preflight-lib.ps1').replace(/'/g, "''");
const script = path.join(here, 'away-preflight.ps1');
const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = probe.status === 0 && Number(String(probe.stdout).trim()) >= 7;

function ps(expr) {
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', `. '${lib}'; ${expr}`], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('away preflight', { skip: !hasPwsh && 'pwsh 7 not installed' }, () => {
  test('a Cloudflare Access redirect is a reachable game', () => {
    const v = ps(
      "Get-GameReachVerdict -StatusCode 302 -Location 'https://x.cloudflareaccess.com/cdn-cgi/access/login/g' -ElapsedMs 300 | ConvertTo-Json -Compress"
    );
    assert.equal(v.Level, 'ok');
    assert.match(v.Text, /sign-in page/);
  });

  test('401, 403 and 200 are reachable; 5xx and errors fail', () => {
    const lv = c =>
      ps(`(Get-GameReachVerdict -StatusCode ${c} -ElapsedMs 100).Level | ConvertTo-Json`);
    assert.equal(lv(200), 'ok');
    assert.equal(lv(403), 'ok');
    assert.equal(lv(502), 'fail');
    assert.equal(ps("(Get-GameReachVerdict -Error 'timed out').Level | ConvertTo-Json"), 'fail');
  });

  test('a slow answer warns', () => {
    assert.equal(
      ps('(Get-GameReachVerdict -StatusCode 200 -ElapsedMs 4000).Level | ConvertTo-Json'),
      'warn'
    );
  });

  test('one screen warns, two are fine', () => {
    assert.equal(ps('(Get-DisplayVerdict -Count 1).Level | ConvertTo-Json'), 'warn');
    assert.equal(ps('(Get-DisplayVerdict -Count 2).Level | ConvertTo-Json'), 'ok');
  });

  test('ready only when nothing failed', () => {
    assert.equal(
      ps(
        "Get-AwayReady -Checks @([pscustomobject]@{Level='ok'},[pscustomobject]@{Level='warn'}) | ConvertTo-Json"
      ),
      true
    );
    assert.equal(
      ps("Get-AwayReady -Checks @([pscustomobject]@{Level='fail'}) | ConvertTo-Json"),
      false
    );
  });

  test('the script refuses an address with a password and one that is not http', () => {
    for (const u of ['https://u:p@x.example.com', 'ftp://x.example.com']) {
      const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, '-Url', u], {
        encoding: 'utf8',
      });
      assert.notEqual(r.status, 0);
    }
  });

  // The script reads the screens through Windows Forms: the live runs are Windows only.
  const live = { skip: process.platform !== 'win32' && 'the script runs on Windows only' };

  test(
    'a live run against a server that redirects to Cloudflare Access reports the game reachable',
    live,
    async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(302, { Location: 'https://x.cloudflareaccess.com/cdn-cgi/access/login/g' });
        res.end();
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      const r = await new Promise(resolve => {
        const child = spawn(
          'pwsh',
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            script,
            '-Url',
            `http://127.0.0.1:${port}`,
            '-SkipDiscord',
          ],
          { encoding: 'utf8' }
        );
        let out = '';
        child.stdout.on('data', d => (out += d));
        child.on('close', () => resolve(out));
      });
      server.close();
      assert.match(r, /OK {2}\] Game address: .*sign-in page/);
    }
  );

  test('a live run against a closed local port reports not ready (exit 1)', live, () => {
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-Url',
        'http://127.0.0.1:9',
        '-SkipDiscord',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout, /FAIL\] Game address/);
    assert.match(r.stdout, /Pack list/);
  });
});
