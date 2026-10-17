// Tests for scripts/tv/start-table-viewer.ps1 (tv-login, G1): the browser command it builds with
// -DryRun, and its refusals. Needs PowerShell 7 (pwsh) and, for the command tests, Edge or Chrome;
// skipped where they are missing.
//   node --test scripts/tv/start-table-viewer.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'start-table-viewer.ps1');
const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = probe.status === 0 && Number(String(probe.stdout).trim()) >= 7;

const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
const hasBrowser = [
  `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
  `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
].some(existsSync);

function run(...args) {
  return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, ...args], {
    encoding: 'utf8',
  });
}

describe('start-table-viewer.ps1', { skip: !hasPwsh && 'pwsh 7 not installed' }, () => {
  test('refuses an address that is not http or https', () => {
    const r = run('-Url', 'file:///C:/secret.txt', '-DryRun');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /http or https/);
  });

  test('refuses an address with a user name or password in it', () => {
    const r = run('-Url', 'https://user:pass@foundry.example.com', '-DryRun');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /user name or password/);
  });

  test('has a Url parameter that is mandatory', () => {
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `(Get-Command '${script.replace(/'/g, "''")}').Parameters['Url'].Attributes.Mandatory`,
      ],
      { encoding: 'utf8' }
    );
    assert.match(r.stdout, /True/);
  });

  test(
    'kiosk mode: full screen, own profile folder, the address last',
    { skip: !hasBrowser && 'no Edge or Chrome installed' },
    () => {
      const r = run('-Url', 'https://foundry.example.com', '-Profile', 'C:\\tvprofile', '-DryRun');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /--kiosk/);
      assert.match(r.stdout, /--user-data-dir=C:\\tvprofile/);
      assert.match(r.stdout.trim(), /https:\/\/foundry\.example\.com\/$/);
    }
  );

  test(
    'auto-join asks the browser for a local debug port; -NoAutoJoin does not',
    { skip: !hasBrowser && 'no Edge or Chrome installed' },
    () => {
      const on = run('-Url', 'https://foundry.example.com', '-DryRun');
      assert.match(on.stdout, /--remote-debugging-port=0/);
      const off = run('-Url', 'https://foundry.example.com', '-NoAutoJoin', '-DryRun');
      assert.doesNotMatch(off.stdout, /remote-debugging/);
    }
  );

  test('the join page matcher accepts only /join of the configured game', () => {
    const lib = path.join(here, 'table-viewer-lib.ps1').replace(/'/g, "''");
    const base = 'https://foundry.example.com';
    const cases = [
      ['https://foundry.example.com/join', true],
      ['https://foundry.example.com/join/', true],
      ['https://foundry.example.com/join?x=1', true],
      ['https://foundry.example.com/game', false],
      ['https://foundry.example.com/', false],
      ['https://foundry.example.com/join/extra', false],
      ['https://evil.example.net/join', false],
      ['http://foundry.example.com/join', false],
      ['https://foundry.example.com:8443/join', false],
      ['https://gnuen.cloudflareaccess.com/cdn-cgi/access/login/foundry.example.com', false],
      ['not a url', false],
    ];
    const body = cases
      .map(([u]) => `(Test-FoundryJoinPage -PageUrl '${u}' -BaseUrl '${base}')`)
      .join(', ');
    const r = spawnSync(
      'pwsh',
      ['-NoProfile', '-Command', `. '${lib}'; (@(${body}) | ConvertTo-Json -Compress)`],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      JSON.parse(r.stdout),
      cases.map(([, ok]) => ok)
    );
  });

  test('the join script puts the user name in as a JSON string and clicks Join', () => {
    const lib = path.join(here, 'table-viewer-lib.ps1').replace(/'/g, "''");
    const r = spawnSync(
      'pwsh',
      ['-NoProfile', '-Command', `. '${lib}'; Get-JoinScript -UserName 'Ta"ble'`],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /u\.value = "Ta\\"ble"/);
    assert.match(r.stdout, /#join-game-form button\[name=join\]/);
    // The page re-checks where it is before typing (the page may have moved on).
    assert.match(r.stdout, /location\.pathname/);
    assert.match(r.stdout, /wrong-page/);
  });

  test(
    'setup mode: a normal window, no kiosk flag',
    { skip: !hasBrowser && 'no Edge or Chrome installed' },
    () => {
      const r = run('-Url', 'https://foundry.example.com', '-Setup', '-DryRun');
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /--kiosk/);
      assert.match(r.stdout, /table-viewer-profile/);
    }
  );
});
