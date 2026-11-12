import type { Express, Request, Response } from 'express';

import { AccessJwtVerifier, accessTokenFrom } from '../access-jwt.js';
import { isGm, resolveRole, type AuthRequest } from '../auth.js';
import type { Config } from '../config.js';
import type { DashboardDeps } from '../dashboard-types.js';
import type { Logger } from '../logger.js';

/** Express middleware: 401/403 unless the caller resolves to the GM role. */
export function createRequireGm(
  auth: Config['auth']
): (req: Request, res: Response, next: () => void) => void {
  return function requireGm(req: Request, res: Response, next: () => void): void {
    const role = resolveRole(req, auth);
    if (!isGm(role)) {
      res
        .status(role ? 403 : 401)
        .json({ code: 'gm-required', error: 'GM access is required for this action.' });
      return;
    }
    next();
  };
}

/**
 * Cloudflare Access (I-022): a verified token's email, set on the request before any route
 * resolves a role. Without the config, or without a valid token, nothing is set. Mount it right
 * after the Host allowlist and before every route (app.ts keeps that order).
 */
export function mountAccessIdentity(
  app: Express,
  options: { config: Config; logger: Logger; accessFetch?: DashboardDeps['accessFetch'] }
): void {
  const { config, logger } = options;
  const accessVerifier = config.auth.access
    ? new AccessJwtVerifier(config.auth.access, options.accessFetch)
    : null;
  if (config.auth.gmEmails.length > 0 && !accessVerifier) {
    logger.warn(
      'GM_EMAILS is set but CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are not: email logins are off'
    );
  }
  // A token that does not verify (or cannot be checked) is marked, not just ignored: a GM behind
  // it would otherwise be told they are a player (presentedUnverifiedAccess, /api/state).
  if (accessVerifier || config.auth.gmEmails.length > 0) {
    app.use((req: Request, _res: Response, next: () => void) => {
      const token = accessTokenFrom(req.headers);
      if (!token) {
        next();
        return;
      }
      const request = req as Request & AuthRequest;
      if (!accessVerifier) {
        request.accessTokenUnverified = true;
        next();
        return;
      }
      accessVerifier.verify(token).then(
        identity => {
          if (identity) request.accessEmail = identity.email;
          else request.accessTokenUnverified = true;
          next();
        },
        () => {
          request.accessTokenUnverified = true;
          next();
        }
      );
    });
  }
}
