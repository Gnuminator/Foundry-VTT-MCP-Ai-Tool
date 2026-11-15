// node --test scripts/sync-skill-plugins.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PLUGINS, plan } from './sync-skill-plugins.mjs';

test('each plugin carries exactly its stub SKILL.md', () => {
  const files = plan();
  for (const p of PLUGINS) {
    const skill = files.get(`plugins/${p.name}/skills/${p.skill}/SKILL.md`);
    assert.equal(skill, readFileSync(new URL(`../${p.stub}`, import.meta.url), 'utf8'));
    assert.match(skill, new RegExp(`^name: ${p.skill}$`, 'm'));
    assert.ok(skill.length < 3000, 'a stub stays small');
  }
  assert.equal(files.size, 1 + PLUGINS.length * 2);
});

test('the marketplace lists every plugin', () => {
  const market = JSON.parse(plan().get('.claude-plugin/marketplace.json'));
  assert.deepEqual(
    market.plugins.map(p => p.name),
    PLUGINS.map(p => p.name)
  );
});
