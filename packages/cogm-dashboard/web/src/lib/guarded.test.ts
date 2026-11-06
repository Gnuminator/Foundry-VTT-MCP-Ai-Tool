import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './api';
import { failCode, mayHaveApplied } from './guarded';

// The page reads its token from the URL at load; there is no page here.
vi.mock('./auth', () => ({ authHeaders: (): Record<string, string> => ({}) }));

describe('mayHaveApplied', () => {
  it('is false for a failure the dashboard threw before anything was sent', () => {
    expect(mayHaveApplied(new ApiError('Internal error', 500, 'internal'))).toBe(false);
  });

  it('is false for an ordinary tool refusal and a 4xx', () => {
    expect(mayHaveApplied(new ApiError('Not there.', 422, 'tool'))).toBe(false);
    expect(mayHaveApplied(new ApiError('Bad request', 400))).toBe(false);
  });

  it('is true for a timeout, a lost link, a bare 5xx and a network failure', () => {
    expect(mayHaveApplied(new ApiError('x', 502, 'timeout'))).toBe(true);
    expect(mayHaveApplied(new ApiError('x', 502, 'channel'))).toBe(true);
    expect(mayHaveApplied(new ApiError('x', 524))).toBe(true);
    expect(mayHaveApplied(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('is true when the plan is gone but the change may have gone in', () => {
    const gone = new ApiError(
      'The plan is gone. It may have been applied already: check list-recent-changes first, then make a new plan.',
      422,
      'tool'
    );
    expect(mayHaveApplied(gone)).toBe(true);
  });
});

describe('failCode', () => {
  it('is the kind, else the status, else network', () => {
    expect(failCode(new ApiError('x', 500, 'internal'))).toBe('internal');
    expect(failCode(new ApiError('x', 404))).toBe('404');
    expect(failCode(new Error('x'))).toBe('network');
  });
});
