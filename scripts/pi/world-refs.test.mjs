// Tests for the pure parts of scripts/pi/world-refs.mjs, and for the stage 11 checks that live next to it
// (the push-back change check runs against a small LevelDB when Foundry's classic-level is on this PC):
//   node --test scripts/pi/world-refs.test.mjs
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  activeModules,
  checkExactPath,
  classifyPath,
  collectPaths,
  gmUserCheck,
  normalizeAssetPath,
  parseArgs,
  pathsInString,
  secretSettingKeys,
  summarize,
  unshippedActive,
  validateAllowMissing,
} from './world-refs.mjs';

test('normalizeAssetPath keeps local asset paths and drops everything else', () => {
  assert.equal(
    normalizeAssetPath('/ddb-images/other/monster/Bat%20Swarm.webp?v=2'),
    'ddb-images/other/monster/Bat Swarm.webp'
  );
  assert.equal(normalizeAssetPath('./tcoe/images/cover.jpg'), 'tcoe/images/cover.jpg');
  assert.equal(normalizeAssetPath('modules/aitool-content/a.OGG'), 'modules/aitool-content/a.OGG');
  assert.equal(normalizeAssetPath('https://example.com/a.png'), null);
  assert.equal(normalizeAssetPath('data:image/png;base64,AAAA'), null);
  assert.equal(normalizeAssetPath('//cdn.example.com/a.png'), null);
  assert.equal(normalizeAssetPath('notes.txt'), null);
  assert.equal(normalizeAssetPath('Fireball.png'), null, 'a bare name is not a path');
  assert.equal(normalizeAssetPath('../secret/a.png'), null);
  assert.equal(normalizeAssetPath('<img src="a/b.png">'), null);
});

test('pathsInString reads src and url() inside HTML', () => {
  const html =
    '<p><img src="/ddb-images/adventures/Curse_of_Strahd/a.webp"> <a href="https://x.org/y.png">x</a></p>' +
    '<div style="background: url(\'modules/aitool-content/b.jpg\')"></div>';
  assert.deepEqual(pathsInString(html).sort(), [
    'ddb-images/adventures/Curse_of_Strahd/a.webp',
    'modules/aitool-content/b.jpg',
  ]);
});

test('collectPaths walks nested objects and arrays', () => {
  const doc = {
    img: 'icons/svg/mystery-man.svg',
    prototypeToken: { texture: { src: 'tokenizer/npc-images/a.png' } },
    items: [{ img: 'worlds/w/x.webp' }, { name: 'text' }],
  };
  assert.deepEqual([...collectPaths(doc)].sort(), [
    'icons/svg/mystery-man.svg',
    'tokenizer/npc-images/a.png',
    'worlds/w/x.webp',
  ]);
});

test('classifyPath sorts paths by root and names the folder to copy', () => {
  assert.deepEqual(classifyPath('icons/svg/x.svg'), { root: 'core' });
  assert.deepEqual(classifyPath('modules/dae/a.png'), { root: 'modules', id: 'dae' });
  assert.deepEqual(classifyPath('worlds/curse-of-strahd/a.png'), {
    root: 'worlds',
    id: 'curse-of-strahd',
  });
  assert.deepEqual(classifyPath('systems/dnd5e/a.png'), { root: 'systems', id: 'dnd5e' });
  assert.deepEqual(classifyPath('ddb-images/adventures/Curse_of_Strahd/assets/a.png'), {
    root: 'ddb-images',
    folder: 'ddb-images/adventures/Curse_of_Strahd',
  });
  assert.deepEqual(classifyPath('ddb-images/other/monster/a.webp'), {
    root: 'ddb-images',
    folder: 'ddb-images/other/monster',
  });
  assert.deepEqual(classifyPath('ddb-images/other/a.webp'), {
    root: 'ddb-images',
    folder: 'ddb-images/other',
  });
  assert.deepEqual(classifyPath('tokenizer/npc-images/a.png'), {
    root: 'tokenizer',
    folder: 'tokenizer/npc-images',
  });
  // Foundry's own public files for the default scene
  assert.deepEqual(classifyPath('nue/defaultscene/a.webp'), { root: 'core' });
  assert.deepEqual(classifyPath('assets/cos1302.jpg'), { root: 'other' });
});

test('summarize reports the problems and the folders', () => {
  const paths = new Set([
    'icons/svg/a.svg',
    'ddb-images/other/monster/a.webp',
    'ddb-images/other/monster/gone.webp',
    'modules/aitool-content/a.png',
    'modules/foundry-mcp-bridge/a.png',
    'modules/JB2A_DnD5e/a.webm',
    'worlds/other-world/a.png',
    'weird/a.png',
  ]);
  const s = summarize(paths, {
    world: 'curse-of-strahd',
    modules: ['aitool-content'],
    exists: p => !p.endsWith('gone.webp') && !p.startsWith('weird/'),
  });
  assert.equal(s.counts['ddb-images'], 2);
  assert.deepEqual(s.folders, ['ddb-images/other/monster']);
  assert.deepEqual([...s.problems.foreignModules], ['JB2A_DnD5e']);
  assert.deepEqual([...s.problems.foreignWorlds], ['other-world']);
  assert.deepEqual(s.problems.missing, ['ddb-images/other/monster/gone.webp']);
  assert.deepEqual(s.problems.other, ['weird/a.png']);
});

test('secretSettingKeys lists key names with a value and never values', () => {
  const docs = [
    { key: 'ddb-importer.cobalt-cookie', value: '"abc"' },
    { key: 'ddb-importer.empty', value: '""' },
    { key: 'foo.apiKey', value: '"k"' },
    { key: 'foo.patreon-token', value: '' },
    { key: 'core.language', value: '"en"' },
    { key: 'bar.Secret', value: 'x' },
    { key: 'core.dynamicTokenRing', value: 'true' },
    { key: 'ddb-importer.entity-spell-compendium', value: '"world.spells"' },
  ];
  assert.deepEqual(secretSettingKeys(docs), [
    'bar.Secret',
    'ddb-importer.cobalt-cookie',
    'ddb-importer.entity-spell-compendium',
    'foo.apiKey',
  ]);
  // a secret word in the name beats the allow list
  assert.deepEqual(secretSettingKeys(docs, ['bar.Secret']), [
    'bar.Secret',
    'ddb-importer.cobalt-cookie',
    'ddb-importer.entity-spell-compendium',
    'foo.apiKey',
  ]);
  assert.deepEqual(secretSettingKeys(docs, ['ddb-importer.entity-*', 'ddb-importer.*']), [
    'bar.Secret',
    'ddb-importer.cobalt-cookie',
    'foo.apiKey',
  ]);
  assert.deepEqual(secretSettingKeys(docs, ['ddb-importer.entity-*']), [
    'bar.Secret',
    'ddb-importer.cobalt-cookie',
    'foo.apiKey',
  ]);
});

test('the allow list never excuses a cookie, token, secret, password or key', () => {
  for (const key of [
    'ddb-importer.cobalt-cookie',
    'ddb-importer.patreon-token',
    'ddb-importer.api-key',
    'ddb-importer.secret',
    'ddb-importer.password',
    'ddb-importer.apikey',
  ]) {
    assert.deepEqual(secretSettingKeys([{ key, value: '"abc"' }], ['ddb-importer.*', key]), [key]);
  }
  assert.deepEqual(
    secretSettingKeys(
      [{ key: 'ddb-importer.entity-spell-compendium', value: '"x"' }],
      ['ddb-importer.entity-*']
    ),
    []
  );
});

test('harmless token settings and module names never count, credential names do', () => {
  const safe = [
    { key: 'core.defaultToken', value: '{"displayName":30}' },
    { key: 'vtta-tokenizer.image-upload-directory', value: '"[data] tokenizer"' },
    { key: 'vtta-tokenizer.frame-directory', value: '"[data] tokenizer/frames"' },
    { key: 'token-action-hud-core.style', value: '"foundryVTT"' },
    { key: 'cookie-module.layout', value: '"wide"' },
    { key: 'core.tokenAutoRotate', value: '"on"' },
  ];
  assert.deepEqual(secretSettingKeys(safe), []);
  const secret = [
    'foo.token',
    'foo.discordToken',
    'foo.refreshToken',
    'foo.sessionToken',
    'foo.privateKey',
    'foo.credentials',
    'foo.refresh-token',
    'foo.session_token',
    'some-bot.bot-token',
    'other.accessToken',
    'foo.private-key',
  ];
  const docs = secret.map(key => ({ key, value: '"abc"' }));
  // the allow list never excuses them either
  assert.deepEqual(secretSettingKeys(docs, ['foo.*', 'some-bot.*', 'other.*']), [...secret].sort());
});

test('checkExactPath compares the exact name, not the NTFS case-blind one', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'world-refs-case-'));
  try {
    mkdirSync(path.join(root, 'ddb-images', 'adventures', 'Curse_of_Strahd'), { recursive: true });
    writeFileSync(path.join(root, 'ddb-images', 'adventures', 'Curse_of_Strahd', 'Map.webp'), 'x');
    const cache = new Map();
    const ok = p => checkExactPath(root, p, cache);
    assert.deepEqual(ok('ddb-images/adventures/Curse_of_Strahd/Map.webp'), { state: 'ok' });
    assert.deepEqual(ok('ddb-images/adventures/Curse_of_Strahd/gone.webp'), { state: 'missing' });
    assert.deepEqual(ok('nothing/here.png'), { state: 'missing' });
    // a different case in the file name, and in a folder name
    assert.deepEqual(ok('ddb-images/adventures/Curse_of_Strahd/map.webp'), {
      state: 'case',
      actual: 'ddb-images/adventures/Curse_of_Strahd/Map.webp',
    });
    assert.deepEqual(ok('ddb-images/Adventures/Curse_of_Strahd/Map.webp'), {
      state: 'case',
      actual: 'ddb-images/adventures/Curse_of_Strahd/Map.webp',
    });
    assert.equal(ok('ddb-images/adventures/Curse_of_Strahd/*.webp').state, 'ok');
    // summarize turns it into a problem line
    const s = summarize(new Set(['ddb-images/adventures/Curse_of_Strahd/map.webp']), {
      world: 'w',
      modules: [],
      check: ok,
    });
    assert.deepEqual(s.problems.caseMismatch, [
      'case differs: ddb-images/adventures/Curse_of_Strahd/map.webp vs ddb-images/adventures/Curse_of_Strahd/Map.webp',
    ]);
    assert.deepEqual(s.problems.missing, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('activeModules and unshippedActive find modules the Pi will not have', () => {
  const docs = [
    {
      key: 'core.moduleConfiguration',
      value: '{"foundry-mcp-bridge":true,"aitool-content":true,"ddb-importer":true,"dae":false}',
    },
  ];
  const active = activeModules(docs);
  assert.deepEqual(active, ['aitool-content', 'ddb-importer', 'foundry-mcp-bridge']);
  assert.deepEqual(unshippedActive(active, ['aitool-content']), ['ddb-importer']);
  assert.deepEqual(activeModules([{ key: 'core.moduleConfiguration', value: { a: true } }]), ['a']);
  assert.deepEqual(activeModules([{ key: 'x', value: '1' }]), []);
  assert.deepEqual(activeModules([{ key: 'core.moduleConfiguration', value: 'not json' }]), []);
});

test('gmUserCheck reports a password or a missing GM, never a value', () => {
  const users = [
    { name: 'Gamemaster', role: 4, password: '$2b$hash' },
    { name: 'Player1', role: 1, password: '' },
  ];
  const withPw = gmUserCheck(users, 'Gamemaster');
  assert.equal(withPw.hasPassword, true);
  assert.equal(withPw.problems.length, 1);
  assert.ok(!JSON.stringify(withPw).includes('hash'));
  assert.deepEqual(
    gmUserCheck([{ name: 'Gamemaster', role: 4, password: '' }], 'Gamemaster').problems,
    []
  );
  assert.equal(gmUserCheck(users, 'Nobody').found, false);
  assert.equal(
    gmUserCheck([{ name: 'Gamemaster', role: 2, password: '' }], 'Gamemaster').found,
    false
  );
  assert.equal(gmUserCheck(users, 'Nobody').problems.length, 1);
});

test('gmUserCheck passwordOk (Plan B push-back): a password is reported but is not a problem', () => {
  const users = [{ name: 'Gamemaster', role: 4, password: '$2b$hash', passwordSalt: 'salt' }];
  const kept = gmUserCheck(users, 'Gamemaster', { passwordOk: true });
  assert.equal(kept.found, true);
  assert.equal(kept.hasPassword, true);
  assert.deepEqual(kept.problems, []);
  assert.ok(!JSON.stringify(kept).includes('hash') && !JSON.stringify(kept).includes('salt'));
  // a missing GM stays a problem
  assert.equal(gmUserCheck(users, 'Nobody', { passwordOk: true }).problems.length, 1);
  // the flag on the command line
  const base = ['--world', 'curse-of-strahd'];
  assert.equal(parseArgs(base).gmPasswordOk, false);
  assert.equal(parseArgs([...base, '--gm-password-ok']).gmPasswordOk, true);
});

test('gmUserCheck: the stored hash of an empty password is not a password (Foundry 14)', () => {
  const salt = 'a1b2c3d4e5f60718';
  const hashOf = pw => pbkdf2Sync(pw, salt, 1000, 64, 'sha512').toString('hex');
  const check = u => gmUserCheck([{ name: 'Gamemaster', role: 4, ...u }], 'Gamemaster');
  // an empty string, with or without a salt
  assert.equal(check({ password: '' }).hasPassword, false);
  assert.equal(check({ password: '', passwordSalt: salt }).hasPassword, false);
  // the hash of the empty password with its salt: no password, no problem
  const empty = check({ password: hashOf(''), passwordSalt: salt });
  assert.equal(empty.found, true);
  assert.equal(empty.hasPassword, false);
  assert.deepEqual(empty.problems, []);
  // the hash of a real password with the same salt: a password
  const real = check({ password: hashOf('x'), passwordSalt: salt });
  assert.equal(real.hasPassword, true);
  assert.equal(real.problems.length, 1);
  // a non-empty password with no salt (or an empty one) still counts, even if it is some other hash
  assert.equal(check({ password: hashOf('') }).hasPassword, true);
  assert.equal(check({ password: hashOf(''), passwordSalt: '' }).hasPassword, true);
  // a salt of another user does not turn the empty hash into a non-password
  assert.equal(check({ password: hashOf(''), passwordSalt: 'other-salt' }).hasPassword, true);
  // neither the hash nor the salt is ever in the result
  for (const r of [empty, real]) {
    const text = JSON.stringify(r);
    assert.ok(!text.includes(salt) && !text.includes(hashOf('x').slice(0, 16)));
  }
});

test('collectPaths skips the D&D Beyond importer metadata under flags.ddb when asked', () => {
  const doc = {
    img: 'icons/svg/a.svg',
    flags: { ddb: { alternateIds: [{ img: 'assets/cos1302.jpg' }] }, other: { img: 'x/keep.png' } },
    items: [{ img: 'worlds/w/i.webp', flags: { ddb: { img: 'assets/item.jpg' } } }],
    notes: [{ flags: { ddb: { img: 'assets/note.jpg' }, mod: { ddb: 'y/z.png' } } }],
    ddb: { img: 'top/ddb-key.png' },
  };
  assert.deepEqual([...collectPaths(doc, new Set(), { skipDdbFlags: true })].sort(), [
    'icons/svg/a.svg',
    'top/ddb-key.png',
    'worlds/w/i.webp',
    'x/keep.png',
    'y/z.png',
  ]);
  // without the option nothing changes for other callers
  assert.ok(collectPaths(doc).has('assets/cos1302.jpg'));
  assert.ok(collectPaths(doc).has('assets/item.jpg'));
});

test('validateAllowMissing accepts paths and prefixes, refuses unsafe entries', () => {
  assert.deepEqual(validateAllowMissing(['a/b.png', ' ddb-images/x/* ']), [
    'a/b.png',
    'ddb-images/x/*',
  ]);
  assert.throws(() => validateAllowMissing(['']), /empty/);
  assert.throws(() => validateAllowMissing(['  ']), /empty/);
  assert.throws(() => validateAllowMissing(['/a/b.png']), /slash/);
  assert.throws(() => validateAllowMissing(['a/../b.png']), /\.\./);
  assert.throws(() => validateAllowMissing(['..']), /\.\./);
});

test('summarize with allowMissing: matching paths are no problem anywhere, only counted', () => {
  const paths = new Set([
    'ddb-images/other/monster/gone.webp',
    'ddb-images/other/monster/here.webp',
    'ddb-images/adventures/Strahd/assets/gone.png',
    'ddb-images/adventures/Strahd/assets/case.png',
    'modules/JB2A_DnD5e/a.webm',
    'modules/aitool-content/miss.png',
    'assets/cos1302.jpg',
    'weird/b.png',
    'icons/svg/a.svg',
  ]);
  const check = p => {
    if (p.endsWith('here.webp')) return { state: 'ok' };
    if (p.endsWith('case.png')) return { state: 'case', actual: 'x' };
    return { state: 'missing' };
  };
  const base = { world: 'w', modules: ['aitool-content'], check };
  const plain = summarize(paths, base);
  assert.equal(plain.allowedMissing.length, 0);
  assert.equal(plain.problems.missing.length, 4);
  const s = summarize(paths, {
    ...base,
    allowMissing: [
      'ddb-images/other/monster/*',
      'ddb-images/adventures/Strahd/assets/*',
      'modules/JB2A_DnD5e/a.webm',
      'modules/aitool-content/miss.png',
      'assets/cos1302.jpg',
      'icons/svg/a.svg',
    ],
  });
  // here.webp exists, so it is not "allowed missing"; icons are core and never checked
  assert.deepEqual(s.allowedMissing, [
    'assets/cos1302.jpg',
    'ddb-images/adventures/Strahd/assets/gone.png',
    'ddb-images/other/monster/gone.webp',
    'modules/JB2A_DnD5e/a.webm',
    'modules/aitool-content/miss.png',
  ]);
  assert.deepEqual(s.problems.missing, []);
  // a wrong-case path stays a problem even when the list matches it (a rename fixes it)
  assert.deepEqual(s.problems.caseMismatch, [
    'case differs: ddb-images/adventures/Strahd/assets/case.png vs x',
  ]);
  assert.deepEqual([...s.problems.foreignModules], []);
  assert.deepEqual(s.problems.other, ['weird/b.png']);
  assert.deepEqual(s.problems.otherPresent, []);
  // an allowed missing path leaves no folder to copy; files that exist (or need a rename) still do
  assert.deepEqual(s.folders, ['ddb-images/adventures/Strahd', 'ddb-images/other/monster']);
  // an exact entry matches only that path
  const one = summarize(new Set(['a/b.png', 'a/b.png.bak.png']), {
    ...base,
    check: () => ({ state: 'missing' }),
    allowMissing: ['a/b.png'],
  });
  assert.deepEqual(one.allowedMissing, ['a/b.png']);
});

test('an unknown-root path that exists on disk is always a problem, allowed or not', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'world-refs-other-'));
  try {
    mkdirSync(path.join(root, 'assets', 'aitool-castle'), { recursive: true });
    writeFileSync(path.join(root, 'assets', 'aitool-castle', 'f1.webp'), 'x');
    const cache = new Map();
    const paths = new Set([
      'assets/aitool-castle/f1.webp',
      'assets/aitool-castle/F1.webp',
      'assets/aitool-castle/gone.webp',
      'assets/never/gone.webp',
    ]);
    const check = p => checkExactPath(root, p, cache);
    const plain = summarize(paths, { world: 'w', modules: [], check });
    assert.deepEqual(plain.problems.otherPresent, [
      'assets/aitool-castle/F1.webp',
      'assets/aitool-castle/f1.webp',
    ]);
    assert.deepEqual(plain.problems.other, [
      'assets/aitool-castle/gone.webp',
      'assets/never/gone.webp',
    ]);
    const allow = ['assets/aitool-castle/*', 'assets/aitool-castle/f1.webp', 'assets/never/*'];
    const s = summarize(paths, { world: 'w', modules: [], check, allowMissing: allow });
    // existing files stay problems; only the really missing ones are excused
    assert.deepEqual(s.problems.otherPresent, [
      'assets/aitool-castle/F1.webp',
      'assets/aitool-castle/f1.webp',
    ]);
    assert.deepEqual(s.allowedMissing, [
      'assets/aitool-castle/gone.webp',
      'assets/never/gone.webp',
    ]);
    assert.deepEqual(s.problems.other, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateAllowMissing refuses patterns that are too broad or misplace the star', () => {
  for (const ok of [
    'ddb-images/adventures/Curse_of_Strahd/*',
    'modules/JB2A_DnD5e/*',
    'modules/JB2A_DnD5e/a*',
    'assets/x/gone.webp',
    'assets/cos1302.jpg',
  ])
    assert.deepEqual(validateAllowMissing([ok]), [ok]);
  for (const bad of [
    '*',
    'modules/*',
    'ddb-images/*',
    'modules/JB2A*',
    'a*b/c/d',
    'a/b/c/**',
    'x/*/y/*',
  ])
    assert.throws(() => validateAllowMissing([bad]), /too broad|last character/, bad);
});

test('--allow-missing on the command line: parsed, validated, and a bad entry stops the run', () => {
  const base = ['--world', 'curse-of-strahd'];
  assert.deepEqual(parseArgs(base).allowMissing, []);
  assert.deepEqual(
    parseArgs([...base, '--allow-missing', 'assets/a.png,modules/x/y/*,,']).allowMissing,
    ['assets/a.png', 'modules/x/y/*']
  );
  for (const bad of ['*', 'modules/*', '/a/b.png', 'a/../b.png'])
    assert.throws(() => parseArgs([...base, '--allow-missing', bad]), /allow-missing/, bad);
  assert.throws(() => parseArgs([...base, '--allow-missing', ' ,x/y.png']), /empty/);
  // the real script exits 1 with the message and runs nothing
  const r = spawnSync(
    process.execPath,
    [
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'world-refs.mjs'),
      ...base,
      '--allow-missing',
      '*',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /too broad/);
});

const remote = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remote');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;

test(
  'stages 11 and 13 and the helpers they run with parse (bash -n)',
  { skip: !hasBash && 'bash is not available' },
  () => {
    for (const file of ['lib.sh', '11-world.sh', '13-player-creation.sh']) {
      const r = spawnSync('bash', ['-n', path.join(remote, file)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${file}: ${r.stderr}`);
    }
  }
);

// Stage 11's push-back change check is a node script inside the stage (only lib.sh and the stage travel over
// SSH). It is cut out here, checked, and run against a small LevelDB when Foundry's classic-level is on this PC.
function stage11ChangeCheck(dir) {
  const text = readFileSync(path.join(remote, '11-world.sh'), 'utf8');
  const m = /<<'NODE' \|\| scan_rc=\$\?\n([\s\S]*?)\nNODE\n/.exec(text);
  assert.ok(m, "11-world.sh has no <<'NODE' change check");
  const file = path.join(dir, 'change-check.mjs');
  writeFileSync(file, m[1] + '\n');
  return file;
}

test('the change check inside stage 11 parses (node --check)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stage11-check-'));
  try {
    const r = spawnSync(process.execPath, ['--check', stage11ChangeCheck(dir)], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const levelPath =
  process.env.FOUNDRY_CLASSIC_LEVEL || 'C:/FoundryTest/app/node_modules/classic-level';
test(
  'the change check inside stage 11 lists documents newer than the snapshot, names only',
  { skip: !existsSync(levelPath) && `no classic-level at ${levelPath}` },
  async () => {
    const { ClassicLevel } = createRequire(import.meta.url)(levelPath);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stage11-check-'));
    try {
      const script = stage11ChangeCheck(dir);
      const since = Date.parse('2026-10-09T02:30:00Z');
      const put = async (db, entries) => {
        mkdirSync(path.dirname(db), { recursive: true });
        const level = new ClassicLevel(db, { valueEncoding: 'utf8' });
        await level.open();
        for (const [k, v] of entries)
          await level.put(k, typeof v === 'string' ? v : JSON.stringify(v));
        await level.close();
      };
      const stats = (created, modified) => ({
        _stats: { createdTime: created, modifiedTime: modified },
      });
      await put(path.join(dir, 'world', 'data', 'actors'), [
        ['!actors!a1', { _id: 'a1', name: 'Old Ireena', ...stats(since - 9e6, since - 1e6) }],
        [
          '!actors!a2',
          {
            _id: 'a2',
            name: 'Changed Ismark',
            secret: 'SECRET-HP',
            ...stats(since - 9e6, since + 2000),
          },
        ],
        [
          '!actors.items!a1.i1',
          { _id: 'i1', name: 'New dagger', ...stats(since + 5000, since + 5000) },
        ],
        ['!actors!bad', 'not json'],
      ]);
      await put(path.join(dir, 'world', 'data', 'settings'), [
        [
          '!settings!s1',
          { _id: 's1', key: 'core.time', value: '1', ...stats(since - 5, since + 1) },
        ],
        ['!settings!s2', { _id: 's2', key: 'core.old', value: '2', ...stats(since - 5, since) }],
      ]);
      await put(path.join(dir, 'world', 'packs', 'lore'), [
        [
          '!journal!j1',
          { _id: 'j1', name: 'Pack page\nwith a newline', ...stats(since + 9000, null) },
        ],
      ]);
      // an empty folder that is no LevelDB is skipped
      mkdirSync(path.join(dir, 'world', 'data', 'empty'), { recursive: true });
      // args: the Pi's world, the bundle's world (a missing folder is an empty world), the snapshot time,
      // then the user names stage 11 provisions
      const run = (time, bundle = path.join(dir, 'no-bundle'), ...names) =>
        spawnSync(
          process.execPath,
          [script, levelPath, path.join(dir, 'world'), bundle, time, ...names],
          { encoding: 'utf8' }
        );

      const r = run('2026-10-09T02:30:00.000Z');
      assert.equal(r.status, 3, r.stderr);
      const lines = r.stdout.trim().split('\n');
      // newer documents, documents scanned (the non-JSON value too), LevelDB folders, newer ones the same in
      // the bundle, newer ones stage 11 provisions itself
      assert.equal(lines[0], '4 7 3 0 0');
      assert.deepEqual(lines.slice(1), [
        `pack:lore/journal Pack page?with a newline ${new Date(since + 9000).toISOString()}`,
        `actors.items New dagger ${new Date(since + 5000).toISOString()}`,
        `actors Changed Ismark ${new Date(since + 2000).toISOString()}`,
        `settings core.time ${new Date(since + 1).toISOString()}`,
      ]);
      assert.ok(!r.stdout.includes('SECRET-HP') && !r.stdout.includes('Old Ireena'));

      const later = run('2026-10-09T02:30:09.000Z');
      assert.equal(later.status, 0, later.stderr);
      assert.equal(later.stdout.trim(), '0 7 3 0 0');

      assert.equal(run('yesterday-ish').status, 1);

      // A rerun on a world an earlier push-back installed: a document with the same key and times in the
      // bundle is the bundle's own, and the users and setting stage 11 provisions do not count either.
      await put(path.join(dir, 'world', 'data', 'users'), [
        ['!users!u1', { _id: 'u1', name: 'Gamemaster', ...stats(since - 9e6, since + 4000) }],
        ['!users!u2', { _id: 'u2', name: 'Player', ...stats(since - 9e6, since + 3000) }],
      ]);
      await put(path.join(dir, 'world', 'data', 'settings'), [
        [
          '!settings!s3',
          { _id: 's3', key: 'foundry-mcp-bridge.bridgeUserId', ...stats(since - 5, since + 7) },
        ],
      ]);
      await put(path.join(dir, 'bundle', 'data', 'actors'), [
        ['!actors!a2', { _id: 'a2', name: 'Changed Ismark', ...stats(since - 9e6, since + 2000) }],
        // same key, other time: the Pi's copy changed again after the push-back
        [
          '!actors.items!a1.i1',
          { _id: 'i1', name: 'New dagger', ...stats(since + 5000, since + 4000) },
        ],
      ]);
      const again = run(
        '2026-10-09T02:30:00.000Z',
        path.join(dir, 'bundle'),
        'Gamemaster',
        'Assistant GM'
      );
      assert.equal(again.status, 3, again.stderr);
      const againLines = again.stdout.trim().split('\n');
      assert.equal(againLines[0], '4 10 4 1 2');
      assert.deepEqual(
        againLines.slice(1).map(l => l.replace(/ \S+$/, '')),
        [
          'pack:lore/journal Pack page?with a newline',
          'actors.items New dagger',
          'users Player',
          'settings core.time',
        ]
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

// Stage 11's push-back module check (keep a module the Pi updated after the backup) is a node script inside the
// stage as well: cut out and run here with two module.json files.
function stage11ModuleCheck(dir) {
  const text = readFileSync(path.join(remote, '11-world.sh'), 'utf8');
  const m = /<<'MODVER'\n([\s\S]*?)\nMODVER\n/.exec(text);
  assert.ok(m, "11-world.sh has no <<'MODVER' module check");
  const file = path.join(dir, 'module-check.cjs');
  writeFileSync(file, m[1] + '\n');
  return file;
}

test('the module check inside stage 11 never downgrades, and keeps the Pi copy when unsure', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stage11-modver-'));
  try {
    const script = stage11ModuleCheck(dir);
    const manifest = (name, content) => {
      const file = path.join(dir, `${name}.json`);
      writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
      return file;
    };
    const check = (pi, bundle) => {
      const r = spawnSync(process.execPath, [script, pi, bundle], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const v = (name, version) => manifest(name, { id: 'm', version });
    for (const [pi, bundle, want] of [
      ['1.2.0', '1.1.9', 'keep 1.2.0 1.1.9'],
      ['1.10.0', '1.9.0', 'keep 1.10.0 1.9.0'],
      ['2.0', '1.9.9', 'keep 2.0 1.9.9'],
      ['1.2.0.1', '1.2.0', 'keep 1.2.0.1 1.2.0'],
      ['v1.3', '1.2', 'keep v1.3 1.2'],
      ['1.2.0', '1.2.0', 'install'],
      ['1.2', '1.2.0', 'install'],
      ['1.2.0', '1.3.0', 'install'],
      ['V1.2.0', 'v1.4.0', 'install'],
      ['1.3.0-rc1', '1.2.0', 'keep 1.3.0-rc1 1.2.0'],
      ['1.2.0', '1.3.0-rc1', 'install'],
      ['1.2.0-rc1', '1.2.0-rc1', 'install'],
      // Same numbers, another suffix: a release and its own release candidate, or two pre-releases.
      ['1.2.0', '1.2.0-rc1', 'unsure 1.2.0 1.2.0-rc1'],
      ['1.2.0-beta.2', '1.2.0', 'unsure 1.2.0-beta.2 1.2.0'],
      ['1.0.0-beta', '1.0.0-alpha', 'unsure 1.0.0-beta 1.0.0-alpha'],
      ['1.2.0+build.5', '1.2', 'unsure 1.2.0+build.5 1.2'],
      ['beta', '1.2.0', 'unsure beta 1.2.0'],
      ['1.2.0', 'latest', 'unsure 1.2.0 latest'],
      ['', '1.2.0', 'unsure ? 1.2.0'],
      ['1.x', '1.2', 'unsure 1.x 1.2'],
    ])
      assert.equal(check(v('pi', pi), v('bundle', bundle)), want, `Pi ${pi}, bundle ${bundle}`);
    assert.equal(check(manifest('pi', '{not json'), v('bundle', '1.0.0')), 'unsure ? 1.0.0');
    assert.equal(check(manifest('pi', { id: 'm' }), v('bundle', '1.0.0')), 'unsure ? 1.0.0');
    assert.equal(check(v('pi', '1.0.0'), path.join(dir, 'missing.json')), 'unsure 1.0.0 ?');
    // No copy on the Pi: nothing to keep.
    assert.equal(check(path.join(dir, 'missing.json'), v('bundle', '1.0.0')), 'install');
    // A version is printed in a warn line: odd characters are masked and long ones cut.
    assert.equal(
      check(v('pi', '1.0 $(rm -rf /)'), v('bundle', '1.0')),
      'unsure 1.0???rm?-rf??? 1.0'
    );
    assert.equal(
      check(v('pi', 'x'.repeat(80)), v('bundle', '1.0')),
      `unsure ${'x'.repeat(40)} 1.0`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the in-browser script of stage 13 parses (node --check)', () => {
  const r = spawnSync(
    process.execPath,
    ['--check', path.join(remote, 'player-creation-settings.mjs')],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
});

// Stage 11 reads login names from a world's env file (env_login, between the ENVLOGIN markers): the GM for the
// push-back change check, the extra GM for the request check and the summary. Cut out and run with bash.
test(
  'env_login in stage 11 prints one login name from an env file, never a password',
  { skip: !hasBash && 'bash is not available' },
  () => {
    const text = readFileSync(path.join(remote, '11-world.sh'), 'utf8');
    const m = /\n(env_login\(\) \{ # ENVLOGIN\n[\s\S]*?\n\} # ENVLOGIN)\n/.exec(text);
    assert.ok(m, '11-world.sh has no env_login between the ENVLOGIN markers');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stage11-envlogin-'));
    try {
      const file = (name, body) => {
        const f = path.join(dir, name);
        writeFileSync(f, body);
        return f.replace(/\\/g, '/');
      };
      // The run's own GM_USER and EXTRA_GM_USER are set, as in the stage: the file's values win, and a file
      // without the line prints nothing (never the run's value).
      const script = [
        'set -euo pipefail',
        m[1],
        'GM_USER=RunGM EXTRA_GM_USER=RunExtra',
        'env_login "$1" "$2"',
      ].join('\n');
      const login = (f, key) => {
        const r = spawnSync('bash', ['-c', script, 'x', f, key], { encoding: 'utf8' });
        return { status: r.status, out: r.stdout, err: r.stderr };
      };
      const ok = out => ({ status: 0, out, err: '' });
      const both = file(
        'both.env',
        'GM_USER="Game Master"\nGM_PASSWORD="pw1-secret"\nEXTRA_GM_USER="Claude"\nEXTRA_GM_PASSWORD="pw2-secret"\n'
      );
      assert.deepEqual(login(both, 'GM_USER'), ok('Game Master'));
      assert.deepEqual(login(both, 'EXTRA_GM_USER'), ok('Claude'));
      const gmOnly = file('gm.env', 'GM_USER="Gamemaster"\nGM_PASSWORD="pw1-secret"\n');
      assert.deepEqual(login(gmOnly, 'GM_USER'), ok('Gamemaster'));
      assert.deepEqual(login(gmOnly, 'EXTRA_GM_USER'), ok(''));
      assert.deepEqual(login(file('pw.env', 'GM_PASSWORD="pw1-secret"\n'), 'GM_USER'), ok(''));
      assert.deepEqual(login(`${dir.replace(/\\/g, '/')}/missing.env`, 'GM_USER'), ok(''));
      // Only the two login keys: a password key (or any other) is refused and prints nothing.
      for (const key of ['GM_PASSWORD', 'EXTRA_GM_PASSWORD', 'PATH']) {
        const r = login(both, key);
        assert.equal(r.status, 1, key);
        assert.equal(r.out, '', key);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
