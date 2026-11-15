import express, { type Express, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import * as fs from 'fs';
import * as path from 'path';

import { gzipAssets } from '../gzip-assets.js';
import { mountGmPage } from '../gm-page.js';
import { liveFrameMiddleware } from '../live-frame.js';
import { OPEN_PAGE_HEADERS } from '../open-route.js';
import { staticHeaders, type StaticHeaderGroup } from '../static-headers.js';
import type { RouteContext } from './context.js';

/**
 * The player page runs only its own script: no inline scripts or event handlers, even if
 * something slipped past the handout sanitizer (inline styles stay allowed for the HP bars).
 */
export const PLAYER_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/** The player page file and its header, on every URL that reaches it (static-headers.ts). */
export const PLAYER_PAGE_HEADERS: StaticHeaderGroup = {
  files: ['player.html', 'me.html', 'party-print.html'],
  apply: res => res.setHeader('Content-Security-Policy', PLAYER_CSP),
};

/**
 * The pages and their files: the React dashboard at /, the GM page, the redirects from the old
 * addresses, the static files and /player. Moved out of app.ts unchanged, in the same order.
 */
export function mountPageRoutes(app: Express, ctx: RouteContext): void {
  const { config, logger, requireGm } = ctx;

  // The player page and the /open confirm page get their headers from inside express.static,
  // by file name and file identity, so no URL spelling (`/player%2Ehtml`, `/Player.html`,
  // `/x/../player.html`) serves them without.
  // The React dashboard is the dashboard at / (D-126); its data comes from the routes below, with
  // the same token. Its files are served under /next/ (Vite's base), where the old name of the
  // page also redirects, keeping the query (a saved link with ?token=).
  const reactIndex = path.join(config.webDir, 'index.html');
  // sendFile takes a root so a folder such as .claude/worktrees above the build does not count as
  // a dotfile.
  const reactIndexName = path.basename(reactIndex);
  const reactIndexRoot = path.dirname(reactIndex);
  if (!fs.existsSync(reactIndex)) {
    logger.warn('The React dashboard is not built: / has no page', {
      webDir: config.webDir,
    });
  }
  // A page load is a few requests a minute; this only stops a runaway loop on the file reads.
  // The limiter is the library's so that CodeQL and the next reader recognise it; one bucket per
  // peer address. Behind the Cloudflare tunnel that is one bucket for the whole tunnel (cloudflared
  // connects from this host), which is fine at these sizes. Do not turn on `trust proxy` to "fix"
  // it: a client could then pick its own bucket with X-Forwarded-For, so the check stays off.
  const pageLimit = rateLimit({
    windowMs: 10_000,
    limit: 1000,
    standardHeaders: false,
    legacyHeaders: false,
    message: 'Too many requests',
    validate: { xForwardedForHeader: false },
  });
  // Who may frame a page: the live strip page lets Foundry (live screen B), the other pages only
  // the dashboard itself.
  app.use(liveFrameMiddleware(config.foundryUrl));
  app.get('/', pageLimit, (_req: Request, res: Response) => {
    // Nothing else to fall back to: say what is missing instead of a bare "Cannot GET /".
    if (!fs.existsSync(reactIndex)) {
      res.status(503).type('text/plain').send('The dashboard is not built: run npm run build.');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(reactIndexName, { root: reactIndexRoot });
  });
  // The GM page (item gm-page-wrapper): Foundry and the live strip on one page.
  mountGmPage(app, {
    sendIndex: (res: Response): boolean => {
      if (!fs.existsSync(reactIndex)) return false;
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(reactIndexName, { root: reactIndexRoot });
      return true;
    },
    foundryUrl: config.foundryUrl,
    pageLimit,
    requireGm,
  });
  // Only a plain query string is carried over (a saved ?token= or ?plan= link); anything else is
  // dropped, and the target is always "/" plus that, so it can never leave this origin.
  app.get(['/next', '/next/', '/legacy', '/legacy/'], pageLimit, (req: Request, res: Response) => {
    const raw = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    res.redirect(302, /^\?[A-Za-z0-9%=&._~+-]*$/.test(raw) ? `/${raw}` : '/');
  });
  // The retired page address (/legacy/) is gone (the user, 2026-10-31): its address goes to / like
  // /next/ above, so a saved link still lands on the dashboard. Its files are not served.
  const publicHeaders = staticHeaders(config.publicDir, [OPEN_PAGE_HEADERS, PLAYER_PAGE_HEADERS]);
  // The pages' stylesheets (unhashed, 11 KB for me.css) go out gzipped; the page headers
  // still come from the same hook, by file, and revalidation works as for express.static.
  const publicCss = gzipAssets(config.publicDir, {
    extensions: ['.css'],
    cacheControl: 'public, max-age=0',
    setHeaders: publicHeaders,
  });
  app.use(publicCss, express.static(config.publicDir, { setHeaders: publicHeaders }));

  // The React dashboard's files: Vite puts a content hash in every file name under assets/, so
  // those are cached for good; index.html is checked on every load so a new build shows up at once.
  // A cold load fetches about twenty files and the end-to-end suite loads pages in parallel from
  // one address, so the assets get their own, much larger bucket than the pages above.
  const assetLimit = rateLimit({
    windowMs: 10_000,
    limit: 5_000,
    standardHeaders: false,
    legacyHeaders: false,
    message: 'Too many requests',
    validate: { xForwardedForHeader: false },
  });
  app.use('/next/assets', assetLimit, gzipAssets(path.join(config.webDir, 'assets')));
  app.use(
    '/next',
    express.static(config.webDir, {
      setHeaders: (res, filePath) => {
        const inAssets = path.relative(path.join(config.webDir, 'assets'), filePath);
        const hashed = !inAssets.startsWith('..') && !path.isAbsolute(inAssets);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
        // The same URL can come back gzipped (gzip-assets.ts) or plain.
        if (hashed) res.setHeader('Vary', 'Accept-Encoding');
      },
    })
  );

  // Clean URL for the read-only player view (the static file is also at /player.html).
  // sendFile skips the static hook, so the route sets the page header itself; Express matches
  // routes case-insensitively and with an optional trailing slash (`/PLAYER`, `/player/`).
  app.get('/player', (_req: Request, res: Response) => {
    PLAYER_PAGE_HEADERS.apply(res);
    res.sendFile('player.html', { root: config.publicDir });
  });
}
