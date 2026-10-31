/**
 * The GM page (item gm-page-wrapper): `/gm` shows Foundry in one pane and the live strip in the
 * other. The page is the React shell like `/`; this file adds the route, the redirect of `/gm/`
 * (so the page's relative links keep resolving) and the one GM-only answer the page needs: where
 * Foundry is, as the GM's browser reaches it (`DASHBOARD_FOUNDRY_URL`).
 */
import fs from 'node:fs';

import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';

import { normalizeFoundryUrl } from './combat-images.js';

export interface GmPageInfo {
  /** Foundry's address for the frame, or null when `DASHBOARD_FOUNDRY_URL` is not set. */
  readonly foundryUrl: string | null;
  /** The origin of that address (what the page compares a message's origin with). */
  readonly foundryOrigin: string | null;
}

/** The address and origin of Foundry from the setting; an empty or invalid one gives nulls. */
export function gmPageInfo(foundryUrl: string | undefined): GmPageInfo {
  const base = normalizeFoundryUrl(foundryUrl ?? '');
  if (base === '') return { foundryUrl: null, foundryOrigin: null };
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { foundryUrl: null, foundryOrigin: null };
    }
    return { foundryUrl: base, foundryOrigin: url.origin };
  } catch {
    return { foundryUrl: null, foundryOrigin: null };
  }
}

/** Only a plain query string is carried over, as for the `/next` redirect; the target is `/gm`. */
export function gmRedirectTarget(originalUrl: string): string {
  const raw = originalUrl.includes('?') ? originalUrl.slice(originalUrl.indexOf('?')) : '';
  return /^\?[A-Za-z0-9%=&._~+-]*$/.test(raw) ? `/gm${raw}` : '/gm';
}

export interface GmPageDeps {
  readonly reactIndex: string;
  readonly foundryUrl: string | undefined;
  readonly pageLimit: RequestHandler;
  readonly requireGm: (req: Request, res: Response, next: () => void) => void;
}

/** Mount `/gm`, its trailing-slash redirect and `/api/gm-page` (GM only). */
export function mountGmPage(app: Application, deps: GmPageDeps): void {
  const info = gmPageInfo(deps.foundryUrl);
  app.get('/api/gm-page', deps.requireGm, (_req: Request, res: Response) => {
    res.json(info);
  });
  app.get('/gm', deps.pageLimit, (req: Request, res: Response, next: NextFunction) => {
    if (req.path.endsWith('/')) {
      res.redirect(302, gmRedirectTarget(req.originalUrl));
      return;
    }
    if (!fs.existsSync(deps.reactIndex)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(deps.reactIndex);
  });
}
