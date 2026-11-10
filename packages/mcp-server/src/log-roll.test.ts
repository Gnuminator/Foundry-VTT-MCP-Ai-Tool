import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RECENT_ROLL_MS, rollLogIfLarge } from './log-roll.js';

describe('rollLogIfLarge', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-roll-'));
    file = path.join(dir, 'wrapper.log');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('leaves a small log alone', () => {
    fs.writeFileSync(file, 'abc');
    rollLogIfLarge(file, 10);
    expect(fs.readFileSync(file, 'utf8')).toBe('abc');
    expect(fs.existsSync(`${file}.1`)).toBe(false);
  });

  it('rolls a large log to .1', () => {
    fs.writeFileSync(file, 'x'.repeat(20));
    rollLogIfLarge(file, 10);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toBe('x'.repeat(20));
  });

  it('does not roll over a .1 another connector has just written', () => {
    fs.writeFileSync(`${file}.1`, 'rolled just now');
    fs.writeFileSync(file, 'y'.repeat(20));
    rollLogIfLarge(file, 10);
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toBe('rolled just now');
    expect(fs.readFileSync(file, 'utf8')).toBe('y'.repeat(20));
  });

  it('replaces an old .1', () => {
    fs.writeFileSync(`${file}.1`, 'old');
    fs.writeFileSync(file, 'z'.repeat(20));
    rollLogIfLarge(file, 10, Date.now() + RECENT_ROLL_MS + 1000);
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toBe('z'.repeat(20));
  });

  it('does nothing when the log is missing', () => {
    expect(() => rollLogIfLarge(file, 10)).not.toThrow();
  });
});
