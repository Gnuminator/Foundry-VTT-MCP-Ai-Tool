import { describe, expect, it, vi } from 'vitest';

import { jsonErrorHandler, publicError } from './error-handler.js';

describe('publicError', () => {
  it('maps body-parser and client errors to short messages', () => {
    expect(publicError({ type: 'entity.parse.failed', status: 400 })).toEqual({
      status: 400,
      body: { error: 'Invalid JSON body' },
    });
    expect(publicError({ type: 'entity.too.large', status: 413 }).status).toBe(413);
    expect(publicError({ statusCode: 404 })).toEqual({
      status: 404,
      body: { error: 'Bad request' },
    });
    expect(publicError(new Error('C:\\secret\\path.ts boom'))).toEqual({
      status: 500,
      body: { error: 'Internal error' },
    });
    expect(publicError(undefined).status).toBe(500);
  });
});

describe('jsonErrorHandler', () => {
  type Spy = ReturnType<typeof vi.fn>;
  function run(
    error: unknown,
    headersSent = false
  ): { logger: { warn: Spy }; res: { status: Spy; json: Spy }; next: Spy } {
    const logger = { warn: vi.fn() };
    const res = {
      headersSent,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();
    jsonErrorHandler(logger as never)(
      error,
      { method: 'POST', path: '/api/tool' } as never,
      res as never,
      next
    );
    return { logger, res, next };
  }

  it('answers with JSON only and logs the details server-side', () => {
    const error = Object.assign(new SyntaxError('Unexpected token x at C:\\app\\x.js'), {
      type: 'entity.parse.failed',
      status: 400,
    });
    const { logger, res, next } = run(error);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid JSON body' });
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(/C:\\|at |stack/);
    expect(logger.warn).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({ path: '/api/tool', status: 400 })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('hands over to Express when the response already started', () => {
    const { res, next } = run(new Error('late'), true);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
