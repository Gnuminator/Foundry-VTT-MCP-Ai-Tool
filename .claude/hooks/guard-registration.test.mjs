// Every guard hook is wired in .claude/settings.json:  node --test .claude/hooks/guard-registration.test.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(readFileSync(path.join(here, '..', 'settings.json'), 'utf8'));
const guards = readdirSync(here).filter(f => /^guard-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs'));

test('no settings file switches every hook off', () => {
  assert.notEqual(settings.disableAllHooks, true);
});

for (const guard of guards) {
  test(`${guard} is wired under hooks.PreToolUse with a matcher`, () => {
    const entry = (settings.hooks?.PreToolUse ?? []).find(e =>
      (e.hooks ?? []).some(h => h.type === 'command' && String(h.command).includes(guard))
    );
    assert.ok(entry, `${guard} is not registered under PreToolUse in .claude/settings.json`);
    assert.ok(String(entry.matcher ?? '').length > 0, `${guard} has no matcher`);
    assert.doesNotThrow(() => new RegExp(`^(?:${entry.matcher})$`), `${guard} matcher is not a regex`);
  });
}
