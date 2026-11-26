import { describe, expect, it } from 'vitest';

import { cellBounds, cellLabel, columnLabel, parseGridLabels } from './grid-labels.js';

const labels = (text: string): string[] => parseGridLabels(text).map(cellLabel);

describe('parseGridLabels', () => {
  it('reads a single square and a rectangle between any two corners', () => {
    expect(labels('C4')).toEqual(['C4']);
    expect(labels('B2 to C3')).toEqual(['B2', 'C2', 'B3', 'C3']);
    expect(labels('C3 to B2')).toEqual(['B2', 'C2', 'B3', 'C3']);
    expect(labels('b2-c3')).toEqual(['B2', 'C2', 'B3', 'C3']);
    expect(labels('B2:B3')).toEqual(['B2', 'B3']);
  });

  it('cuts out everything after "without"', () => {
    const cells = labels('C4 to H9, without E6 to F7');
    expect(cells).toHaveLength(6 * 6 - 4);
    expect(cells).not.toContain('E6');
    expect(cells).not.toContain('F7');
    expect(cells).toContain('C4');
    expect(cells).toContain('H9');
    expect(labels('A1 to C1 except B1')).toEqual(['A1', 'C1']);
  });

  it('unites parts into an L shape without duplicates', () => {
    const cells = labels('A1 to B4, A3 to D4');
    expect(cells).toHaveLength(8 + 8 - 4);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('counts columns past Z', () => {
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(labels('AA1')).toEqual(['AA1']);
    expect(parseGridLabels('AA1')[0]).toEqual({ i: 0, j: 26 });
  });

  it('gives the bounding box as column, row, width, height', () => {
    expect(cellBounds(parseGridLabels('C4 to H9, without E6 to F7'))).toEqual([2, 3, 6, 6]);
  });

  it('refuses text it cannot read and empty results', () => {
    expect(() => parseGridLabels('')).toThrow(/empty/);
    expect(() => parseGridLabels('hello')).toThrow(/not a grid square/);
    expect(() => parseGridLabels('A0')).toThrow(/not a grid square/);
    expect(() => parseGridLabels('A1 to B2 to C3')).toThrow(/two corners/);
    expect(() => parseGridLabels('A1 to B2, without A1 to B2')).toThrow(/Nothing is left/);
    expect(() => parseGridLabels('A1 without B1 without C1')).toThrow(/once/);
    expect(() => parseGridLabels('without B1')).toThrow(/before/);
    expect(() => parseGridLabels('A1 to ZZ999')).toThrow(/more than/);
    expect(() => parseGridLabels('C4 to H9, without E16')).toThrow(/not in the room: E16/);
  });
});
