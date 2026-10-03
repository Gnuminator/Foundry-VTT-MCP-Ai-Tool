/**
 * The After view's session notes card (recap lane, D-087) is GM only: the players' page never
 * asks for session notes and has no card; only the Recap reaches players, through the reveal.
 */
import { readFileSync } from 'fs';

import { describe, expect, it } from 'vitest';

const read = (file: string): string =>
  readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');

describe('session notes card', () => {
  it('lives only on the GM page', () => {
    expect(read('index.html')).toContain('id="notes-card"');
    expect(read('app.js')).toContain('/api/session-notes');
  });

  it('never appears on the players page', () => {
    for (const file of ['player.html', 'player.js']) {
      const text = read(file);
      expect(text).not.toContain('session-notes');
      expect(text).not.toContain('notes-card');
    }
  });
});
