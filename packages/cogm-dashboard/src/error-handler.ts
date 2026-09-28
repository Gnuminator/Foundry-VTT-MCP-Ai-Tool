/**
 * Final Express error handler for the dashboard. Express's default handler
 * answers with an HTML page holding the full stack trace and local file paths,
 * and body parsing runs before any auth check, so any caller could see them
 * (for example by posting malformed JSON). This answers with a short JSON
 * error instead and logs the details on the server only.
 */
import type { NextFunction, Request, Response } from 'express';

import type { Logger } from './logger.js';

interface HttpishError {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
}

/** The status and public message for an error (never its stack or paths). */
export function publicError(error: unknown): { status: number; body: { error: string } } {
  const e = (error ?? {}) as HttpishError;
  if (e.type === 'entity.parse.failed') {
    return { status: 400, body: { error: 'Invalid JSON body' } };
  }
  if (e.type === 'entity.too.large') {
    return { status: 413, body: { error: 'Request body too large' } };
  }
  const status = Number(e.status ?? e.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return { status, body: { error: 'Bad request' } };
  }
  return { status: 500, body: { error: 'Internal error' } };
}

export function jsonErrorHandler(logger: Logger) {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    const { status, body } = publicError(error);
    logger.warn('Request failed', {
      method: req.method,
      path: req.path,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(status).json(body);
  };
}
