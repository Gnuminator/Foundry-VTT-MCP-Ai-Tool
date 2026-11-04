// api(): the message a failed route shows, in words (item dashboard-truth, dashboard-plain-errors).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, errorText, plainError, plainText } from './api';

vi.mock('./auth', () => ({ authHeaders: (): Record<string, string> => ({}) }));

function answer(status: number, body: unknown, json = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (): Promise<unknown> => ({
        ok: status >= 200 && status < 300,
        status,
        json: async (): Promise<unknown> => {
          if (!json) throw new SyntaxError('Unexpected token <');
          return body;
        },
      })
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('api errors', () => {
  it('reads {error: {message, code}} so the After panel shows the message, not HTTP 409', async () => {
    answer(409, { error: { message: 'Someone else staged these notes.', code: 'conflict' } });
    const err = await api('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Someone else staged these notes.');
    expect((err as ApiError).code).toBe('conflict');
    expect((err as ApiError).status).toBe(409);
  });

  it('still reads {error: "text"}', async () => {
    answer(403, { error: 'GM Actions are off.', code: 'gm-actions-disabled' });
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe('GM Actions are off.');
    expect(err.code).toBe('gm-actions-disabled');
  });

  it('words a failure with no message instead of HTTP <status>', async () => {
    answer(502, {});
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe(plainError(502));
    expect(err.message).not.toMatch(/HTTP|502/);
  });

  it('treats a 200 that is not JSON as a login needed', async () => {
    answer(200, undefined, false);
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(401);
    expect(err.code).toBe('login-needed');
    expect(err.message).toMatch(/GM link/);
  });
});

describe('plainError', () => {
  it('has a sentence for every status and no code in it', () => {
    for (const s of [400, 401, 403, 404, 409, 408, 500, 502, 504]) {
      expect(plainError(s)).toMatch(/\.$/);
      expect(plainError(s)).not.toMatch(/\d{3}|HTTP/);
    }
  });
});

describe('plainText', () => {
  it('drops the tails written for Claude', () => {
    expect(
      plainText(
        'Paper sync is switched off. In Foundry, open "Paper sync". Tell the GM and stop here; do not work around it with other tools.'
      )
    ).toBe('Paper sync is switched off. In Foundry, open "Paper sync".');
    expect(
      plainText(
        'Foundry is down. Tell the GM that Foundry is not connected (the world must be open); do not retry.'
      )
    ).toBe('Foundry is down.');
  });

  it('drops the plan-gone tail that names tools', () => {
    const text = errorText(
      new Error(
        'That plan is gone. It may have been applied already: check list-recent-changes first. If it was not, list the pending plans with get-planned-change or make a new plan.'
      )
    );
    expect(text).toBe('That plan is gone.');
  });

  it('turns a tool id into words', () => {
    expect(plainText('plan-combat-change failed')).toBe('combat change failed');
    expect(plainText('Unknown tool: undo-change.')).toBe('Unknown tool: undo.');
  });

  it('never returns an empty message', () => {
    expect(plainText('   ')).toBe(plainError(500));
  });
});
