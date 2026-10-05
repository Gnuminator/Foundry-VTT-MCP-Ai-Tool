import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KIT_WORLDS } from '../lib/contract.mjs';
import { EnvError } from '../lib/errors.mjs';
import { SRD_PROFILE_FILE, loadProfile, profileFile, validateProfile } from '../lib/profiles.mjs';

/** A valid profile body, changed by `more`. @param {Record<string, any>} [more] */
function profile(more = {}) {
  return {
    id: 'mine',
    world: 'ai-tool-kit-licensed',
    title: 'Mine',
    modules: ['some-module'],
    packs: {
      classes: ['dnd5e.classes24'],
      subclasses: ['dnd5e.classes24'],
      species: ['dnd5e.origins24'],
      backgrounds: ['dnd5e.origins24'],
      monsters: ['dnd5e.actors24'],
      spells: ['dnd5e.spells24'],
      feats: ['dnd5e.feats24'],
    },
    ...more,
  };
}

/** A kit home with `<home>/licensed/profiles/<id>.json`. @param {string} id @param {unknown} body */
function homeWith(id, body) {
  const home = mkdtempSync(path.join(tmpdir(), 'kit-profiles-'));
  const dir = path.join(home, 'licensed', 'profiles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}.json`),
    typeof body === 'string' ? body : JSON.stringify(body)
  );
  return home;
}

test('the srd profile ships in the repo, is valid and builds in a kit world', () => {
  const p = loadProfile('srd');
  assert.equal(p.id, 'srd');
  assert.ok(KIT_WORLDS.includes(p.world));
  assert.deepEqual(validateProfile(p), []);
  assert.deepEqual(p.select.rules, ['2024', '2014']);
  assert.equal(profileFile('srd'), SRD_PROFILE_FILE);
  assert.ok(p.packs.classes.length > 0 && p.packs.subclasses.length > 0);
});

test('validateProfile accepts a good profile and names each problem of a bad one', () => {
  assert.deepEqual(validateProfile(profile()), []);
  assert.deepEqual(validateProfile(null), ['the profile is not an object']);
  assert.match(validateProfile(profile({ id: 'Bad Id' })).join(), /id must be kebab-case/);
  assert.match(validateProfile(profile({ title: ' ' })).join(), /title is missing/);
  assert.match(validateProfile(profile({ modules: ['bad module!'] })).join(), /modules/);
  assert.match(validateProfile(profile({ packs: undefined })).join(), /packs is missing/);
  assert.match(
    validateProfile(profile({ packs: { ...profile().packs, classes: [] } })).join(),
    /packs.classes is empty/
  );
  assert.match(
    validateProfile(profile({ packs: { ...profile().packs, feats: ['nopoint'] } })).join(),
    /packs.feats must be a list of pack ids/
  );
  assert.match(
    validateProfile(profile({ packs: { ...profile().packs, spells: undefined } })).join(),
    /packs.spells/
  );
  assert.match(validateProfile(profile({ select: { rules: ['2000'] } })).join(), /select.rules/);
  assert.match(
    validateProfile(profile({ select: { rules: ['2024'], skipNames: [1] } })).join(),
    /skipNames/
  );
  assert.match(
    validateProfile(profile({ select: { rules: ['2024'], skipIds: '(' } })).join(),
    /skipIds must be a regular expression/
  );
  assert.deepEqual(
    validateProfile(profile({ select: { rules: ['2024'], skipIds: '^x', skipNames: ['A'] } })),
    []
  );
});

test('a world that is not a kit world is refused, also the everyday test worlds', () => {
  for (const world of ['ai-tool-test', 'ai-tool-kit', 'curse-of-strahd']) {
    const problems = validateProfile(profile({ world }));
    assert.match(problems.join(), /world must be one of/, world);
    const home = homeWith('mine', profile({ world }));
    assert.throws(
      () => loadProfile('mine', { home }),
      e => e instanceof EnvError && /world must be one of/.test(e.message)
    );
  }
});

test('an unknown profile, a bad id and a broken file are environment errors', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'kit-profiles-'));
  assert.throws(
    () => loadProfile('nope', { home }),
    e => e instanceof EnvError && /No profile "nope"/.test(e.message)
  );
  for (const id of ['../srd', 'a/b', '', 'UPPER']) {
    assert.throws(
      () => loadProfile(id, { home }),
      e => e instanceof EnvError && /REFUSED/.test(e.message),
      id
    );
  }
  assert.throws(
    () => loadProfile('broken', { home: homeWith('broken', '{ not json') }),
    /not valid JSON/
  );
  assert.throws(
    () => loadProfile('other', { home: homeWith('other', profile({ id: 'mine' })) }),
    /does not match the file name/
  );
});

test('a local profile loads from <kit home>/licensed/profiles and gets its select defaults', () => {
  const home = homeWith('mine', profile());
  assert.equal(profileFile('mine', home), path.join(home, 'licensed', 'profiles', 'mine.json'));
  const p = loadProfile('mine', { home });
  assert.equal(p.world, 'ai-tool-kit-licensed');
  assert.deepEqual(p.modules, ['some-module']);
  assert.deepEqual(p.select, { rules: ['2024', '2014'], skipNames: [] });
  const custom = loadProfile('mine', {
    home: homeWith(
      'mine',
      profile({ select: { rules: ['2024'], skipNames: ['X'], skipIds: '^z' } })
    ),
  });
  assert.deepEqual(custom.select, { rules: ['2024'], skipNames: ['X'], skipIds: '^z' });
});
