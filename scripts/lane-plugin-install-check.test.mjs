import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referencedHooks } from './lane-plugin-install-check.mjs';

test('referencedHooks lists plugin-root scripts once, sorted', () => {
  const hooks = {
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/b.mjs"' },
            { command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/a.mjs"' },
          ],
        },
        { hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/a.mjs"' }] },
      ],
    },
  };
  assert.deepEqual(referencedHooks(hooks), ['hooks/a.mjs', 'hooks/b.mjs']);
});

test('referencedHooks ignores commands without a plugin-root path and empty input', () => {
  assert.deepEqual(referencedHooks({ hooks: { Stop: [{ hooks: [{ command: 'echo hi' }] }] } }), []);
  assert.deepEqual(referencedHooks({}), []);
});
