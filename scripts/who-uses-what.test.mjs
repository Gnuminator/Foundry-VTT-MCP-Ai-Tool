import assert from 'node:assert/strict';
import test from 'node:test';

import { renderWhoUsesWhat } from './who-uses-what.mjs';

const report = {
  schema: 1,
  generatedAt: '2026-11-17T12:00:00.000Z',
  days: 7,
  current: '0.29.2',
  people: [
    {
      key: 'gm',
      role: 'gm',
      name: null,
      calls: 4,
      errors: 1,
      lastSeen: '2026-11-17T11:00:00.000Z',
      topTools: [{ name: 'get-world-info', calls: 3 }],
      skills: [{ skill: 'gm-coach', stub: 1, calls: 1 }],
      controls: { events: 2, top: [{ name: 'dash.view|x', uses: 2 }] },
      versions: [
        { piece: 'obsidian', install: 'abc123abc123', name: '', version: '0.28.0', behind: true, lastSeen: '2026-11-17T11:00:00.000Z' },
      ],
    },
  ],
  tools: { used: 1, neverCalled: ['a-tool'], errorRates: [{ name: 'get-world-info', calls: 3, errors: 1 }] },
};

test('renders a row per person, versions flagged and never-called tools', () => {
  const md = renderWhoUsesWhat(report);
  assert.match(md, /\| GM \| 4 \| 0 \| 1 \|/);
  assert.match(md, /gm-coach \(stub 1\) 1/);
  assert.match(md, /BEHIND/);
  assert.match(md, /Never called \(1\): a-tool/);
  // A pipe in a name cannot break the table.
  assert.ok(!md.split('```json')[0].includes('dash.view|x'));
});

test('the note ends with the report as one fenced json block', () => {
  const md = renderWhoUsesWhat(report);
  const m = /```json\n(.*)\n```/.exec(md);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1]), report);
});
