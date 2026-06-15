import crypto from 'crypto';
import type { AuthConfig } from './config.js';

/**
 * Server-side role resolution for the player/GM split (Phase 6).
 *
 * This is pure plumbing — no Express coupling beyond a tiny structural request
 * shape — so it unit-tests without a server. The split is OPT-IN: when
 * `auth.splitEnabled` is false the dashboard is single-user GM (legacy/default).
 *
 * Resolution order when the split is active:
 *   1. Cloudflare Access email header ∈ GM allow-list   → 'gm'
 *   2. GM token (header / query / cookie) matches        → 'gm'
 *   3. player token required and matches                 → 'player'
 *   4. player token NOT required                         → 'player' (read-only)
 *   5. otherwise                                         → null (unauthorized)
 *
 * The GM token never reaches a player; redaction (see redact.ts) strips GM-only
 * data from everything a 'player' is served, server-side.
 */
export type Role = 'gm' | 'player';

/** The minimal request surface auth needs (a real Express req satisfies it). */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
}

const GM_TOKEN_HEADER = 'x-cogm-token';
const TOKEN_QUERY = 'token';
const TOKEN_COOKIE = 'cogm_token';

function headerValue(req: AuthRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Extract a presented token from header, query, or cookie (in that order). */
export function extractToken(req: AuthRequest): string | undefined {
  const fromHeader = headerValue(req, GM_TOKEN_HEADER);
  if (fromHeader) return fromHeader;
  const q = req.query?.[TOKEN_QUERY];
  if (typeof q === 'string' && q !== '') return q;
  return parseCookie(headerValue(req, 'cookie'), TOKEN_COOKIE);
}

/** Constant-time string compare (avoids leaking token length/contents via timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Resolve the caller's role, or null if the split is active and they're unauthorized. */
export function resolveRole(req: AuthRequest, auth: AuthConfig): Role | null {
  // Legacy single-user mode: no split configured → everyone is the GM.
  if (!auth.splitEnabled) return 'gm';

  // 1. Cloudflare Access identity (header injected by the Access gate in front).
  if (auth.gmEmails.length > 0) {
    const email = headerValue(req, auth.cfAccessEmailHeader)?.toLowerCase();
    if (email && auth.gmEmails.includes(email)) return 'gm';
  }

  // 2 & 3. Presented token.
  const token = extractToken(req);
  if (token && auth.gmToken !== '' && safeEqual(token, auth.gmToken)) return 'gm';

  if (auth.playerToken !== '') {
    return token && safeEqual(token, auth.playerToken) ? 'player' : null;
  }

  // 4. Player view is open to anyone the (optional) outer gate let through.
  return 'player';
}

/** True if the role may use the write/AI/control surface. */
export function isGm(role: Role | null): role is 'gm' {
  return role === 'gm';
}
