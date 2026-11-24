// node --test .claude/hooks/tool-added.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addedTools, openSteps, toolEntries } from './tool-added.mjs';

const mod = (extra = '') => `export const m = defineToolModule({
  id: 'x',
  routes: {},
  tools: {
    'old-tool': {
      set: 'core',
      title: 'Old',
      kind: 'read',
    },${extra}
  },
});
`;
const NEW = `
    'new-tool': {
      set: 'build',
      title: 'New',
      kind: 'write',
    },`;

test('reads the entries of the tools map only', () => {
  assert.deepEqual([...toolEntries(mod(NEW)).keys()], ['old-tool', 'new-tool']);
});

test('names only tools the committed file lacks', () => {
  assert.deepEqual(
    addedTools(mod(), mod(NEW)).map(([n]) => n),
    ['new-tool']
  );
  assert.deepEqual(addedTools(mod(NEW), mod(NEW)), []);
  assert.deepEqual(
    addedTools('', mod()).map(([n]) => n),
    ['old-tool']
  );
});

test('lists open steps for a write tool and none when all are done', () => {
  const block = toolEntries(mod(NEW)).get('new-tool');
  const none = () => '';
  const steps = openSteps('new-tool', block, none);
  assert.equal(steps.length, 3);
  assert.match(steps.join('\n'), /sweep/);
  assert.match(steps.join('\n'), /docs:tools/);
  assert.match(steps.join('\n'), /write-gate/);
  const done = f => (f.includes('TOOL-SETS') ? '`new-tool`' : 'new-tool');
  assert.deepEqual(
    openSteps('new-tool', block, done).filter(s => !/write-gate/.test(s)),
    []
  );
});

test('plan-* tools (kind read) and destructive tools need the sweep step; plain reads do not', () => {
  const blk = kind => `    'x': {\n      set: 'core',\n      kind: '${kind}',\n    },`;
  const docs = f => (f.includes('TOOL-SETS') ? '`plan-x` `x`' : "'plan-xy'");
  assert.equal(openSteps('plan-x', blk('read'), docs).filter(s => /sweep/.test(s)).length, 1);
  assert.equal(openSteps('x', blk('destructive'), docs).filter(s => /sweep/.test(s)).length, 1);
  assert.deepEqual(openSteps('x', blk('read'), docs), []);
});

test('a read tool with two sets is flagged', () => {
  const block = "    'r': {\n      set: 'core',\n      set: 'play',\n      kind: 'read',\n    },";
  const steps = openSteps('r', block, () => '`r`');
  assert.equal(steps.length, 1);
  assert.match(steps[0], /exactly one/);
});
