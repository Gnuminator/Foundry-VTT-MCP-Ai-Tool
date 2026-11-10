import { describe, expect, it } from 'vitest';
import { describeError } from './log.js';

describe('describeError', () => {
  it('prints a message, never an object dump', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
    const out = describeError({ headers: { authorization: 'Bot SECRET' } });
    expect(out).not.toContain('SECRET');
  });
});
