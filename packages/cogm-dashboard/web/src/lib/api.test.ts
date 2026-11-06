// api(): the message a failed route shows, in words (item dashboard-truth, dashboard-plain-errors).
import {
  NOT_CONNECTED_TAIL,
  PLAN_GONE_TAIL,
  STOP_AND_TELL,
  featureSwitchOff,
  notFoundMessage,
} from '@gnuminator/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, errorText, plainError, plainText } from './api';

vi.mock('./auth', () => ({ authHeaders: (): Record<string, string> => ({}) }));

function answer(status: number, body: unknown, json = true, type = 'application/json'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (): Promise<unknown> => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (): string => type },
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

  it("words the dashboard's own internal 500 and keeps its kind and status", async () => {
    answer(500, { error: 'Internal error', kind: 'internal' });
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe(plainError(500));
    expect(err.kind).toBe('internal');
    expect(err.status).toBe(500);
  });

  it('treats a 200 page that is not JSON as a login needed', async () => {
    answer(200, undefined, false, 'text/html; charset=utf-8');
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(401);
    expect(err.code).toBe('login-needed');
    expect(err.message).toMatch(/GM link/);
  });

  it('takes an empty JSON-typed 200 as an empty answer, not a lost login', async () => {
    answer(200, undefined, false, 'application/json');
    await expect(api('/x')).resolves.toEqual({});
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
    ).toBe(
      'Foundry is down. Foundry is not connected: open the world in a browser with a GM joined.'
    );
  });

  it('strips the shared wording the tools send Claude (so an edit there cannot bring it back)', () => {
    expect(plainText(`Nothing happened. ${STOP_AND_TELL}`)).toBe('Nothing happened.');
    expect(plainText(`Nothing happened. ${PLAN_GONE_TAIL}`)).toBe(
      'Nothing happened. It may have applied; check Recent Changes.'
    );
    expect(plainText(notFoundMessage('That journal', 'list-journals'))).toBe(
      'That journal not found.'
    );
    expect(plainText(`Not there. ${NOT_CONNECTED_TAIL}`)).toBe(
      'Not there. Foundry is not connected: open the world in a browser with a GM joined.'
    );
    expect(plainText(featureSwitchOff('Paper sync', 'Paper sync'))).not.toMatch(/Tell the GM/);
  });

  it('words the plan-gone tail as may-have-applied', () => {
    const text = errorText(
      new Error(
        'That plan is gone. It may have been applied already: check list-recent-changes first. If it was not, list the pending plans with get-planned-change or make a new plan.'
      )
    );
    expect(text).toBe('That plan is gone. It may have applied; check Recent Changes.');
  });

  it('turns a tool id into words', () => {
    expect(plainText('plan-combat-change failed')).toBe('combat change failed');
    expect(plainText('Unknown tool: undo-change.')).toBe('Unknown tool: undo.');
  });

  it('leaves a plan or change id (a digit in its tail) alone', () => {
    expect(plainText('Plan plan-m3x9k-1a2b3c4d is gone')).toBe('Plan plan-m3x9k-1a2b3c4d is gone');
    expect(plainText('No change-1a2b3c4d')).toBe('No change-1a2b3c4d');
  });

  it('strips the bridge query prefix', () => {
    expect(plainText('Query foundry-mcp-bridge.openDocumentForGm failed: No document found.')).toBe(
      'No document found.'
    );
  });

  it('never returns an empty message', () => {
    expect(plainText('   ')).toBe(plainError(500));
  });
});
