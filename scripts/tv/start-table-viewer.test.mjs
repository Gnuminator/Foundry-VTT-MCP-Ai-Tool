// Tests for scripts/tv/start-table-viewer.ps1 (tv-login, G1): the browser command it builds with
// -DryRun, and its refusals. Needs PowerShell 7 (pwsh) and, for the command tests, Edge or Chrome;
// skipped where they are missing.
//   node --test scripts/tv/start-table-viewer.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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

  test('the join page matcher follows the path prefix of the address (reverse proxy)', () => {
    const lib = path.join(here, 'table-viewer-lib.ps1').replace(/'/g, "''");
    const cases = [
      // [base address, page, accepted]
      ['https://host.example.com/foundry', 'https://host.example.com/foundry/join', true],
      ['https://host.example.com/foundry/', 'https://host.example.com/foundry/join/', true],
      ['https://host.example.com/foundry/join', 'https://host.example.com/foundry/join', true],
      ['https://host.example.com/foundry', 'https://host.example.com/join', false],
      ['https://host.example.com/foundry', 'https://host.example.com/foundry/game', false],
      ['https://host.example.com/foundry', 'https://host.example.com/other/join', false],
      ['https://host.example.com/foundry', 'https://host.example.com/foundry/join/extra', false],
      ['https://host.example.com/join', 'https://host.example.com/join', true],
      // The address bar of the game itself is not a prefix.
      ['https://host.example.com/game', 'https://host.example.com/join', true],
      ['https://host.example.com/foundry/game', 'https://host.example.com/foundry/join', true],
      ['https://host.example.com', 'https://host.example.com/foundry/join', false],
    ];
    const body = cases
      .map(([b, u]) => `(Test-FoundryJoinPage -PageUrl '${u}' -BaseUrl '${b}')`)
      .join(', ');
    const r = spawnSync(
      'pwsh',
      ['-NoProfile', '-Command', `. '${lib}'; (@(${body}) | ConvertTo-Json -Compress)`],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      JSON.parse(r.stdout),
      cases.map(([, , ok]) => ok)
    );
  });

  test('the join script checks the prefixed join path in the page too', () => {
    const lib = path.join(here, 'table-viewer-lib.ps1').replace(/'/g, "''");
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `. '${lib}'; Get-JoinScript -UserName 'Table' -Prefix '/foundry'; Get-JoinScript -UserName 'Table'`,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    const [withPrefix, without] = r.stdout.trim().split(/\r?\n/);
    assert.match(withPrefix, /!== "\/foundry\/join"/);
    assert.match(without, /!== "\/join"/);
  });

  test('the profile is in use while a browser holds its lockfile', () => {
    const lib = path.join(here, 'table-viewer-lib.ps1').replace(/'/g, "''");
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tv-profile-'));
    try {
      const probe = d =>
        spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-Command',
            `. '${lib}'; Test-ProfileInUse -Profile '${d.replace(/'/g, "''")}'`,
          ],
          { encoding: 'utf8' }
        ).stdout.trim();
      assert.equal(probe(dir), 'False', 'no lockfile');
      writeFileSync(path.join(dir, 'lockfile'), '');
      assert.equal(probe(dir), 'False', 'a leftover lockfile nobody holds');
      // One process holds the file open (no sharing) while another asks.
      const holder = path.join(dir, 'lockfile').replace(/'/g, "''");
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `. '${lib}'; $f = [IO.File]::Open('${holder}', 'Open', 'ReadWrite', 'None'); try { Test-ProfileInUse -Profile '${dir.replace(/'/g, "''")}' } finally { $f.Dispose() }`,
        ],
        { encoding: 'utf8' }
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), 'True');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(
    'refuses to start while a browser holds the profile, before it opens another',
    { skip: !hasBrowser && 'no Edge or Chrome installed' },
    () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'tv-profile-'));
      try {
        writeFileSync(path.join(dir, 'lockfile'), '');
        const holder = path.join(dir, 'lockfile').replace(/'/g, "''");
        // The holder runs this very script (-NonInteractive) while it holds the lockfile.
        const r = spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$f = [IO.File]::Open('${holder}', 'Open', 'ReadWrite', 'None'); try { & '${script.replace(/'/g, "''")}' -Url https://foundry.example.com -NoAutoJoin -Profile '${dir.replace(/'/g, "''")}' } finally { $f.Dispose() }`,
          ],
          { encoding: 'utf8' }
        );
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /already running on this profile/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  test('the guide puts -NoExit in the Startup shortcut and explains the path prefix', () => {
    const guide = readFileSync(
      path.join(here, '..', '..', 'docs', 'gm', 'tv-table-viewer.md'),
      'utf8'
    );
    assert.match(guide, /pwsh -NoExit [^\n]*start-table-viewer\.ps1/);
    assert.match(guide, /https:\/\/host\/foundry\/join/);
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
