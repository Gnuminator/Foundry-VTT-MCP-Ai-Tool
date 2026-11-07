import { describe, expect, it, vi } from 'vitest';

import { PLAN_GONE_TAIL } from '@gnuminator/shared';

import { ApiError, errorText } from './api';
import { failCode, mayHaveApplied, rewordMayHaveApplied } from './guarded';

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
    const gone = new ApiError(`The plan is gone. ${PLAN_GONE_TAIL}`, 422, 'tool');
    expect(mayHaveApplied(gone)).toBe(true);
  });
});

describe('rewordMayHaveApplied', () => {
  it("swaps the plan-gone sentence for this call's own place to look, once", () => {
    const text = errorText(new Error(`That plan is gone. ${PLAN_GONE_TAIL}`));
    const hint = 'It may have applied; check the Tarokka drawer.';
    const out = rewordMayHaveApplied(text, hint);
    expect(out).toBe(`That plan is gone. ${hint}`);
    expect(out.match(/may have applied/g)).toHaveLength(1);
  });

  it('keeps the text after the swapped sentence', () => {
    expect(
      rewordMayHaveApplied('Foo. It may have applied; check X. Bar', 'Look at the feed.')
    ).toBe('Foo. Bar. Look at the feed.');
  });

  it('adds a stop to a text that has none', () => {
    expect(rewordMayHaveApplied('Nothing came back', 'Check it.')).toBe(
      'Nothing came back. Check it.'
    );
  });
});

describe('failCode', () => {
  it('is the kind, else the status, else network', () => {
    expect(failCode(new ApiError('x', 500, 'internal'))).toBe('internal');
    expect(failCode(new ApiError('x', 404))).toBe('404');
    expect(failCode(new Error('x'))).toBe('network');
  });
});
