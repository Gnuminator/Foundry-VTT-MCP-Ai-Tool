/**
 * Live screen B (item live-screen-b-foundry): the live strip page `/?strip=1` is framed by the
 * Foundry module's Live window. The other dashboard pages say only the dashboard itself may frame
 * them ('self'); this page alone lets Foundry, and only Foundry's own address does (`DASHBOARD_FOUNDRY_URL`, the address the GM's
 * browser uses). Without that setting nobody but the dashboard itself may, and the window shows
 * an empty frame; the setting's hint in Foundry says so.
 */
import type { NextFunction, Request, Response } from 'express';
import * as path from 'path';

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

/**
 * The header for a request that asks for the strip page, else null. The page reads the first
 * `strip` value (`URLSearchParams.get`), so this reads the raw query the same way: Express would
 * turn `?strip=1&strip=1` into a list and the header would be skipped for a page that still loads.
 */
export function liveFrameHeader(
  originalUrl: string,
  foundryUrl: string | undefined
): string | null {
  const search = originalUrl.includes('?') ? originalUrl.slice(originalUrl.indexOf('?')) : '';
  if (new URLSearchParams(search).get('strip') === '1') {
    return `frame-ancestors ${liveFrameAncestors(foundryUrl)}`;
  }
  return isPagePath(originalUrl.split('?')[0] ?? '') ? "frame-ancestors 'self'" : null;
}

/**
 * Whether a path can serve a dashboard page: no file extension (`/`, `/next/`) or a
 * `.html`, whatever the spelling (`/INDEX.HTML`, `/index%2Ehtml`, `/x/../index.html`). Pages that
 * set their own header (open, player, GM) overwrite this one; the API and the assets stay as they
 * are. Nobody but the dashboard itself may frame the rest.
 */
function isPagePath(rawPath: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return true;
  }
  const clean = path.posix.normalize(decoded.replace(/\\/g, '/')).toLowerCase();
  if (clean === '/api' || clean.startsWith('/api/')) return false;
  const ext = path.posix.extname(clean);
  return ext === '' || ext === '.html' || ext === '.htm';
}

/** Express middleware: sets the header on a request with `?strip=1` or one for a dashboard page. */
export function liveFrameMiddleware(foundryUrl: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = liveFrameHeader(req.originalUrl, foundryUrl);
    if (value !== null) res.setHeader('Content-Security-Policy', value);
    next();
  };
}
