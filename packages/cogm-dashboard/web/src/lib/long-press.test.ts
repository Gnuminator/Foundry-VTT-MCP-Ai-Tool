import { describe, expect, it } from 'vitest';

import { titleAt, type TitleNode } from './long-press';

function node(title: string | null, parent: TitleNode | null = null): TitleNode {
  return { getAttribute: () => title, parentElement: parent };
}

describe('titleAt', () => {
  it('finds the nearest title inside the root', () => {
    const root = node(null);
    const button = node(' Undo it ', root);
    const span = node(null, button);
    expect(titleAt(span, root)).toBe('Undo it');
    expect(titleAt(node(null, root), root)).toBeNull();
  });
  it('does not read the root or climb above it', () => {
    const outer = node('outer');
    const root = node('root', outer);
    expect(titleAt(root, root)).toBeNull();
    expect(titleAt(node(null, root), root)).toBeNull();
  });
  it('is null for no element', () => {
    expect(titleAt(null, node(null))).toBeNull();
  });
});
