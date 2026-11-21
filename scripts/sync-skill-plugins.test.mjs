// node --test scripts/sync-skill-plugins.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OFFLINE_PAGES } from '../tools/gm-coach/build.mjs';
import { PLUGINS, plan } from './sync-skill-plugins.mjs';

test('each plugin carries exactly its stub SKILL.md', () => {
  const files = plan();
  for (const p of PLUGINS) {
    const skill = files.get(`plugins/${p.name}/skills/${p.skill}/SKILL.md`);
    assert.equal(skill, readFileSync(new URL(`../${p.stub}`, import.meta.url), 'utf8'));
    assert.match(skill, new RegExp(`^name: ${p.skill}$`, 'm'));
    assert.ok(skill.length < 3000, 'a stub stays small');
  }
  assert.equal(files.size, 1 + PLUGINS.length * 2 + Object.keys(OFFLINE_PAGES).length);
});

test('the GM coach plugin carries the offline runbook and troubleshooting pages', () => {
  const files = plan();
  for (const [to, from] of Object.entries(OFFLINE_PAGES)) {
    assert.equal(
      files.get(`plugins/foundry-gm-coach/skills/foundry-gm-coach/${to}`),
      readFileSync(new URL(`../${from}`, import.meta.url), 'utf8')
    );
  }
});

test('the marketplace lists every plugin', () => {
  const market = JSON.parse(plan().get('.claude-plugin/marketplace.json'));
  assert.deepEqual(
    market.plugins.map(p => p.name),
    PLUGINS.map(p => p.name)
  );
});
