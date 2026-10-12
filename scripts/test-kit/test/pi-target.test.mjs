import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EnvError } from '../lib/errors.mjs';
import {
  MAX_SECRET_LENGTH,
  assertRemoteHost,
  isLocalAddress,
  isThisPc,
  NOT_GAME_NIGHT_MESSAGE,
  PI_DEFAULTS,
  PI_WORLD,
  kitTargetsFile,
  loadPiConfig,
  piPreflight,
  readDashboardToken,
  readKitGmPassword,
  readSecretFile,
  reportTarget,
  resolvePiTarget,
} from '../lib/pi-target.mjs';

const TOKEN = 'tok-9f3a-SECRET-TEXT';
const PASSWORD = 'pw-77b1-SECRET-TEXT';

/** A temp folder holding a targets file (and optionally secret files); returns its env. */
function setup(pi, { raw } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-pi-'));
  const file = path.join(dir, 'kit-targets.json');
  writeFileSync(file, raw ?? JSON.stringify(pi === undefined ? {} : { pi }));
  return { dir, file, env: { KIT_TARGETS_FILE: file } };
}

/** @param {() => unknown} fn @param {RegExp} re */
function refused(fn, re) {
  assert.throws(fn, e => {
    assert.ok(e instanceof EnvError, `an EnvError, got ${e}`);
    assert.match(e.message, /^REFUSED: /, e.message);
    if (re) assert.match(e.message, re);
    return true;
  });
}

const ok = { notGameNight: true };

test('the targets file: KIT_TARGETS_FILE wins, else %LOCALAPPDATA%\\foundry-ai-tool', () => {
  assert.equal(
    kitTargetsFile({ KIT_TARGETS_FILE: 'X:\\k.json', LOCALAPPDATA: 'C:\\L' }),
    'X:\\k.json'
  );
  assert.equal(
    kitTargetsFile({ LOCALAPPDATA: 'C:\\L' }),
    path.join('C:\\L', 'foundry-ai-tool', 'kit-targets.json')
  );
  assert.throws(() => kitTargetsFile({}), /KIT_TARGETS_FILE/);
});

test('an entry with nothing in it takes the defaults', () => {
  const { env, file } = setup({});
  assert.deepEqual(loadPiConfig(env), { file, ...PI_DEFAULTS });
  assert.deepEqual(PI_DEFAULTS, { host: 'foundry-pi', dashboardPort: 3000, foundryPort: 30000 });
});

test('a missing or unreadable file, bad JSON and no pi entry are helpful EnvErrors without a stack', () => {
  const missing = { KIT_TARGETS_FILE: path.join(os.tmpdir(), 'kit-pi-nope', 'kit-targets.json') };
  const cases = [
    [missing, /cannot be read/],
    [setup(undefined, { raw: '{not json' }).env, /not valid JSON/],
    [setup(undefined).env, /no "pi" entry/],
    [setup(undefined, { raw: '{"pi": "foundry-pi"}' }).env, /no "pi" entry/],
    [setup(undefined, { raw: '{"pi": [1]}' }).env, /no "pi" entry/],
    [setup(undefined, { raw: 'null' }).env, /no "pi" entry/],
  ];
  for (const [env, re] of cases) {
    assert.throws(
      () => loadPiConfig(env),
      e => {
        assert.ok(e instanceof EnvError);
        assert.match(e.message, re);
        assert.match(
          e.message,
          new RegExp(path.basename(env.KIT_TARGETS_FILE).replace('.', '\\.'))
        );
        assert.match(e.message, /"dashboardPort": 3000/, 'shows the example');
        assert.doesNotMatch(e.message, /\n\s+at /, 'no stack in the message');
        return true;
      }
    );
  }
});

test('invalid JSON text is never quoted back (a parse message can quote the file)', () => {
  const { env } = setup(undefined, { raw: `{"pi": {"password": "${PASSWORD}"` });
  assert.throws(
    () => loadPiConfig(env),
    e => {
      assert.ok(!e.message.includes(PASSWORD));
      return true;
    }
  );
});

test('any key but the five known ones is refused: the key is named, its value never', () => {
  for (const key of ['password', 'token', 'kitGmPassword', 'dashboardToken', 'apiKey']) {
    const { env } = setup({ host: 'foundry-pi', [key]: PASSWORD });
    assert.throws(
      () => loadPiConfig(env),
      e => {
        assert.ok(e instanceof EnvError);
        assert.match(e.message, /^REFUSED: /);
        assert.ok(e.message.includes(`"${key}"`), e.message);
        assert.ok(!e.message.includes(PASSWORD), 'the value is not in the message');
        return true;
      },
      key
    );
  }
  // a value that looks like a secret under a known key is a type problem, not echoed either
  const { env } = setup({ host: `${PASSWORD} x` });
  assert.throws(
    () => loadPiConfig(env),
    e => !e.message.includes(PASSWORD)
  );
});

test('host: letters, digits, dots and hyphens only', () => {
  for (const host of ['foundry-pi', 'pi.tail1234.ts.net', '100.64.0.7', 'Pi1']) {
    assert.equal(loadPiConfig(setup({ host }).env).host, host, host);
  }
  for (const host of [
    'a b',
    'foo/bar',
    'foo:80',
    '-x',
    'x.',
    '',
    'a@b',
    'foo_bar',
    123,
    null,
    ['x'],
  ]) {
    assert.throws(
      () => loadPiConfig(setup({ host }).env),
      e => e instanceof EnvError && /pi\.host/.test(e.message),
      JSON.stringify(host)
    );
  }
});

test('loopback and this PC are refused as the pi host, however they are spelled', () => {
  const hosts = [
    '127.0.0.1',
    '127.1',
    '127.255.0.9',
    'localhost',
    'LOCALHOST',
    'pi.localhost',
    '0.0.0.0',
    '0',
    '0x7f000001',
    '2130706433',
    '0177.0.0.1',
  ];
  const own = os.hostname();
  if (/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(own)) hosts.push(own, own.toUpperCase());
  for (const host of hosts) {
    refused(() => resolvePiTarget({ ...ok, env: setup({ host }).env }), /another machine/);
  }
  // an IPv6 literal does not even pass the host rule
  for (const host of ['::1', '[::1]']) {
    assert.throws(
      () => resolvePiTarget({ ...ok, env: setup({ host }).env }),
      e => e instanceof EnvError && /pi\.host/.test(e.message),
      host
    );
  }
  assert.throws(
    () => resolvePiTarget({ ...ok, env: setup({ host: '999.1.1.1' }).env }),
    e => e instanceof EnvError
  );
});

test('ports: whole numbers 1 to 65535; the live bridge ports are refused for both', () => {
  for (const key of ['dashboardPort', 'foundryPort']) {
    for (const bad of ['3000', 3000.5, 0, 65536, -1, null, true]) {
      assert.throws(
        () => loadPiConfig(setup({ [key]: bad }).env),
        e => e instanceof EnvError && e.message.includes(`pi.${key}`),
        `${key} ${JSON.stringify(bad)}`
      );
    }
    for (const port of [31414, 31415, 31416]) {
      refused(
        () => resolvePiTarget({ ...ok, env: setup({ [key]: port }).env }),
        new RegExp(`port ${port} is the live bridge`)
      );
    }
    assert.doesNotThrow(() => resolvePiTarget({ ...ok, env: setup({ [key]: 31417 }).env }));
    assert.doesNotThrow(() => resolvePiTarget({ ...ok, env: setup({ [key]: 65535 }).env }));
  }
});

test('the two secret file paths must be absolute paths', () => {
  for (const key of ['dashboardTokenFile', 'kitGmPasswordFile']) {
    for (const bad of ['token.txt', '..\\token.txt', '', 5]) {
      assert.throws(
        () => loadPiConfig(setup({ [key]: bad }).env),
        e => e instanceof EnvError && e.message.includes(`pi.${key}`),
        `${key} ${JSON.stringify(bad)}`
      );
    }
  }
});

test('the pi target: URLs from host and ports, the fixed world, file paths and no secrets', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-pi-secrets-'));
  const tokenFile = path.join(dir, 'token.txt');
  const passwordFile = path.join(dir, 'kit-gm.txt');
  writeFileSync(tokenFile, `${TOKEN}\r\n`);
  writeFileSync(passwordFile, `\uFEFF${PASSWORD}\n`);
  const { env } = setup({
    host: 'Foundry-Pi',
    dashboardPort: 3000,
    foundryPort: 30000,
    dashboardTokenFile: tokenFile,
    kitGmPasswordFile: passwordFile,
  });
  const target = resolvePiTarget({ ...ok, env });
  assert.deepEqual(target, {
    name: 'pi',
    dashboard: 'http://foundry-pi:3000',
    foundry: 'http://foundry-pi:30000',
    world: 'strahd-kit',
    host: 'foundry-pi',
    dashboardTokenFile: tokenFile,
    kitGmPasswordFile: passwordFile,
    kitGmUser: 'Kit GM',
  });
  assert.equal(PI_WORLD, 'strahd-kit');
  // the secrets come out of their files and nowhere else
  assert.equal(readDashboardToken(target), TOKEN);
  assert.equal(readKitGmPassword(target), PASSWORD);
  for (const text of [
    JSON.stringify(target),
    String(target),
    JSON.stringify(reportTarget(target)),
  ]) {
    assert.ok(!text.includes(TOKEN), 'no token in the target');
    assert.ok(!text.includes(PASSWORD), 'no password in the target');
  }
  // the report part names where the Pi is, nothing from the files
  assert.deepEqual(reportTarget(target), {
    name: 'pi',
    host: 'foundry-pi',
    dashboard: 'http://foundry-pi:3000',
    foundry: 'http://foundry-pi:30000',
    world: 'strahd-kit',
  });
});

test('without the file keys the target has no file paths, and the token is null', () => {
  const target = resolvePiTarget({ ...ok, env: setup({}).env });
  assert.equal(target.dashboardTokenFile, undefined);
  assert.equal(target.kitGmPasswordFile, undefined);
  assert.equal(readDashboardToken(target), null);
  assert.throws(() => readKitGmPassword(target), /kitGmPasswordFile/);
});

test('guard (a): the world is strahd-kit and nothing else', () => {
  const { env } = setup({});
  assert.equal(resolvePiTarget({ ...ok, env }).world, 'strahd-kit');
  assert.equal(resolvePiTarget({ ...ok, world: 'strahd-kit', env }).world, 'strahd-kit');
  for (const world of [
    'ai-tool-kit-srd',
    'ai-tool-kit-licensed',
    'curse-of-strahd',
    'ai-tool-test',
    '',
  ]) {
    refused(() => resolvePiTarget({ ...ok, world, env }), /throwaway world "strahd-kit"/);
  }
});

test('guard (b): without notGameNight nothing runs, not even a file read', () => {
  const missing = { KIT_TARGETS_FILE: path.join(os.tmpdir(), 'kit-pi-nope', 'x.json') };
  for (const notGameNight of [undefined, false, 'yes', 1]) {
    assert.throws(
      () => resolvePiTarget({ notGameNight, env: missing }),
      e => e instanceof EnvError && e.message === NOT_GAME_NIGHT_MESSAGE
    );
  }
  assert.match(
    NOT_GAME_NIGHT_MESSAGE,
    /^REFUSED: pass --not-game-night to confirm today is not a game night/
  );
  assert.match(NOT_GAME_NIGHT_MESSAGE, /game-night day\)$/);
});

test('guard (d): fake mode never combines with pi', () => {
  refused(
    () => resolvePiTarget({ ...ok, fake: true, env: setup({}).env }),
    /never runs in fake mode/
  );
});

test('readSecretFile: trims, and an error names the file but never the content', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-pi-read-'));
  const put = (name, text) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    return file;
  };
  assert.equal(readSecretFile(put('a.txt', `  ${TOKEN} \r\n`)), TOKEN);
  assert.equal(
    readSecretFile(put('max.txt', 'x'.repeat(MAX_SECRET_LENGTH))).length,
    MAX_SECRET_LENGTH
  );
  const bad = {
    'empty.txt': ['', /is empty/],
    'blank.txt': [' \r\n\r\n', /is empty/],
    'two.txt': [`${TOKEN}\nsecond line`, /one line only/],
    'long.txt': [`${TOKEN}${'x'.repeat(MAX_SECRET_LENGTH)}`, /longer than 200 characters/],
  };
  for (const [name, [text, re]] of Object.entries(bad)) {
    const file = put(name, text);
    assert.throws(
      () => readSecretFile(file),
      e => {
        assert.ok(e instanceof EnvError);
        assert.match(e.message, re);
        assert.ok(e.message.includes(file), 'names the file');
        assert.ok(!e.message.includes(TOKEN), 'does not quote the content');
        assert.ok(!e.message.includes('second line'), 'does not quote the content');
        return true;
      },
      name
    );
  }
  const none = path.join(dir, 'none.txt');
  assert.throws(
    () => readSecretFile(none),
    e => e instanceof EnvError && e.message.includes(none)
  );
});

// --- the preflight ------------------------------------------------------------------------

const piTarget = { foundry: 'http://foundry-pi:30000' };

/** A fetch that answers `/api/status` with `body` (or fails). */
function statusFetch(body, { status = 200, fails = false, text } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (fails) throw new TypeError('fetch failed');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (text !== undefined) return JSON.parse(text);
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

test('piPreflight accepts a Pi that runs strahd-kit', async () => {
  const { fetchImpl, calls } = statusFetch({
    active: true,
    world: 'strahd-kit',
    version: '14.368',
  });
  const status = await piPreflight(piTarget, { fetchImpl });
  assert.deepEqual(status, { active: true, world: 'strahd-kit' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://foundry-pi:30000/api/status');
});

test('piPreflight refuses the campaign world and names the way to start the kit session', async () => {
  const { fetchImpl } = statusFetch({ active: true, world: 'curse-of-strahd' });
  await assert.rejects(piPreflight(piTarget, { fetchImpl }), e => {
    assert.ok(e instanceof EnvError);
    assert.equal(
      e.message,
      "REFUSED: the Pi is launching 'curse-of-strahd', not strahd-kit: start the kit session first (kit-session.sh MODE=up, docs/dev/PI-SETUP.md)"
    );
    return true;
  });
});

test('piPreflight refuses a Foundry that is not running a world, does not answer, or is not JSON', async () => {
  await assert.rejects(
    piPreflight(piTarget, { fetchImpl: statusFetch({ active: false }).fetchImpl }),
    e => e instanceof EnvError && /not running a world: start the kit session first/.test(e.message)
  );
  await assert.rejects(
    piPreflight(piTarget, { fetchImpl: statusFetch({ world: 'strahd-kit' }).fetchImpl }),
    e => e instanceof EnvError && /not running a world/.test(e.message)
  );
  await assert.rejects(
    piPreflight(piTarget, { fetchImpl: statusFetch(null, { fails: true }).fetchImpl }),
    e =>
      e instanceof EnvError &&
      /^The Pi's Foundry does not answer at http:\/\/foundry-pi:30000/.test(e.message)
  );
  await assert.rejects(
    piPreflight(piTarget, { fetchImpl: statusFetch(null, { text: '<html>' }).fetchImpl }),
    e => e instanceof EnvError && /did not answer \/api\/status with JSON/.test(e.message)
  );
  await assert.rejects(
    piPreflight(piTarget, { fetchImpl: statusFetch(null, { status: 502 }).fetchImpl }),
    e => e instanceof EnvError && /HTTP 502/.test(e.message)
  );
});

// --- "this PC" (review of #329, L2) -------------------------------------------------------------

/** A PC called Gamer-PC with a LAN, a Tailscale and an IPv6 address. */
const PC = {
  hostname: 'Gamer-PC',
  interfaces: {
    Ethernet: [{ address: '192.168.1.20', family: 'IPv4' }],
    Tailscale: [
      { address: '100.101.102.103', family: 'IPv4' },
      { address: 'fd7a:115c:a1e0::1', family: 'IPv6' },
    ],
    Wi: [{ address: 'fe80::1%12', family: 'IPv6' }],
  },
};

test('isLocalAddress: loopback, unspecified and every address of the PC, in any spelling', () => {
  for (const a of [
    '127.0.0.1',
    '127.8.8.8',
    '::1',
    '[::1]',
    '::',
    '0.0.0.0',
    '::ffff:127.0.0.1',
    '192.168.1.20',
    '100.101.102.103',
    '::ffff:192.168.1.20',
    'FD7A:115C:A1E0::1',
    'fe80::1%7',
  ]) {
    assert.equal(isLocalAddress(a, PC), true, a);
  }
  for (const a of ['100.64.0.7', '192.168.1.21', '203.0.113.9', 'fd7a:115c:a1e0::2']) {
    assert.equal(isLocalAddress(a, PC), false, a);
  }
});

test('isThisPc: the PC name, its first label (a Tailscale name), its addresses', () => {
  for (const h of [
    'gamer-pc',
    'GAMER-PC',
    'gamer-pc.tail1234.ts.net',
    'gamer-pc.lan',
    'localhost',
    'x.localhost',
    '192.168.1.20',
    '100.101.102.103',
    '127.0.0.1',
  ]) {
    assert.equal(isThisPc(h, PC), true, h);
  }
  for (const h of ['foundry-pi', 'foundry-pi.tail1234.ts.net', '100.64.0.7', 'gamer-pc2']) {
    assert.equal(isThisPc(h, PC), false, h);
  }
  // a PC name with a domain: its first label counts too
  assert.equal(isThisPc('gamer-pc', { ...PC, hostname: 'Gamer-PC.corp.example' }), true);
});

test('the pi target refuses the PC LAN or Tailscale address and its Tailscale name', () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  for (const host of [...addresses, `${os.hostname().split('.')[0]}.tail1234.ts.net`]) {
    if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)) continue;
    refused(() => resolvePiTarget({ ...ok, env: setup({ host }).env }), /another machine/);
  }
});

test('assertRemoteHost: every address the name resolves to must be another machine', async () => {
  const seen = [];
  const lookup = answer => async (host, opts) => {
    seen.push([host, opts]);
    return answer;
  };
  await assertRemoteHost('foundry-pi', {
    ...PC,
    lookup: lookup([{ address: '100.64.0.7' }, { address: 'fd7a:115c:a1e0::9' }]),
  });
  assert.deepEqual(seen, [['foundry-pi', { all: true }]], 'all addresses are asked for');
  for (const bad of ['127.0.0.1', '100.101.102.103', '192.168.1.20', 'fd7a:115c:a1e0::1']) {
    await assert.rejects(
      assertRemoteHost('foundry-pi', {
        ...PC,
        lookup: lookup([{ address: '100.64.0.7' }, { address: bad }]),
      }),
      e =>
        e instanceof EnvError &&
        /^REFUSED: the pi target must be another machine, but foundry-pi resolves to /.test(
          e.message
        ) &&
        e.message.includes(bad),
      bad
    );
  }
});

test('assertRemoteHost: a name that does not resolve is an EnvError', async () => {
  const fails = async () => {
    throw Object.assign(new Error('getaddrinfo ENOTFOUND foundry-pi'), { code: 'ENOTFOUND' });
  };
  await assert.rejects(
    assertRemoteHost('foundry-pi', { ...PC, lookup: fails }),
    e =>
      e instanceof EnvError &&
      /cannot be resolved/.test(e.message) &&
      !/getaddrinfo/.test(e.message)
  );
  await assert.rejects(
    assertRemoteHost('foundry-pi', { ...PC, lookup: async () => [] }),
    e => e instanceof EnvError && /cannot be resolved/.test(e.message)
  );
});
