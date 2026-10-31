/**
 * Live screen B (item live-screen-b-foundry): the live strip page `/?strip=1` is framed by the
 * Foundry module's Live window. Every other page stays as it is; this page alone says who may
 * frame it, and only Foundry's own address does (`DASHBOARD_FOUNDRY_URL`, the address the GM's
 * browser uses). Without that setting nobody but the dashboard itself may, and the window shows
 * an empty frame; the setting's hint in Foundry says so.
 */
import type { NextFunction, Request, Response } from 'express';

import { normalizeFoundryUrl } from './combat-images.js';

/** The `frame-ancestors` value: Foundry's origin, else the dashboard's own. */
export function liveFrameAncestors(foundryUrl: string | undefined): string {
  const base = normalizeFoundryUrl(foundryUrl ?? '');
  if (base === '') return "'self'";
  try {
    return new URL(base).origin;
  } catch {
    return "'self'";
  }
}

/** The header for a request that asks for the strip page, else null. */
export function liveFrameHeader(
  query: Request['query'],
  foundryUrl: string | undefined
): string | null {
  return query['strip'] === '1' ? `frame-ancestors ${liveFrameAncestors(foundryUrl)}` : null;
}

/** Express middleware: sets the header on any request with `?strip=1`. */
export function liveFrameMiddleware(foundryUrl: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = liveFrameHeader(req.query, foundryUrl);
    if (value !== null) res.setHeader('Content-Security-Policy', value);
    next();
  };
}
