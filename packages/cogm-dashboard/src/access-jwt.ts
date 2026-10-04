import crypto from 'crypto';

/**
 * Cloudflare Access login check (I-022, closes the rest of P-038; needed before players reach the
 * Pi through Access, D-075).
 *
 * Cloudflare Access sends every request it lets through with a signed token, the
 * `Cf-Access-Jwt-Assertion` header (and the `CF_Authorization` cookie). Its email claim is the only
 * email the dashboard trusts: the plain `cf-access-authenticated-user-email` header can be sent by
 * anyone who reaches the dashboard some other way, so it is never read.
 *
 * The token is checked with Node's own crypto (no new dependency): RS256 signature against the
 * team's published keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, cached and
 * fetched again for an unknown key id), the issuer (the team domain), the audience (the Access
 * application's AUD tag), and the expiry (30 s clock skew allowed).
 */

/** What the dashboard needs to check Access tokens. Absent: email logins are off. */
export interface AccessJwtConfig {
  /** The team domain, e.g. `myteam.cloudflareaccess.com`. */
  readonly teamDomain: string;
  /** The Access application's AUD tag(s); a token must name one of them. */
  readonly audiences: readonly string[];
}

/** The verified identity from a token. */
export interface AccessIdentity {
  readonly email: string;
}

interface Jwk {
  kid?: unknown;
  kty?: unknown;
  n?: unknown;
  e?: unknown;
}

const SKEW_MS = 30_000;
const KEYS_TTL_MS = 60 * 60 * 1000;
/** An unknown key id refetches the keys at most this often (no hammering Cloudflare). */
const REFETCH_MIN_MS = 30_000;
const TEAM_DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

/** The team domain from `CF_ACCESS_TEAM_DOMAIN` (with or without `https://`), or '' when invalid. */
export function parseTeamDomain(raw: string): string {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return TEAM_DOMAIN.test(host) ? host : '';
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The Access token of a request: the `Cf-Access-Jwt-Assertion` header, else the cookie. */
export function accessTokenFrom(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const raw = headers['cf-access-jwt-assertion'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (header) return header.trim();
  const cookie = headers.cookie;
  return cookieValue(Array.isArray(cookie) ? cookie[0] : cookie, 'CF_Authorization');
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export class AccessJwtVerifier {
  private keys = new Map<string, crypto.KeyObject>();
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly config: AccessJwtConfig,
    private readonly fetchImpl: FetchLike = (url): ReturnType<FetchLike> => fetch(url),
    private readonly now: () => number = (): number => Date.now()
  ) {}

  /** The issuer a token must name. */
  get issuer(): string {
    return `https://${this.config.teamDomain}`;
  }

  private refresh(): Promise<void> {
    this.inflight ??= (async (): Promise<void> => {
      try {
        const res = await this.fetchImpl(`${this.issuer}/cdn-cgi/access/certs`);
        if (!res.ok) throw new Error('Cloudflare Access keys could not be fetched');
        const body = (await res.json()) as { keys?: unknown };
        const next = new Map<string, crypto.KeyObject>();
        for (const jwk of Array.isArray(body.keys) ? (body.keys as Jwk[]) : []) {
          if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue;
          if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
          next.set(
            jwk.kid,
            crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
          );
        }
        this.keys = next;
      } finally {
        this.fetchedAt = this.now();
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async keyFor(kid: string): Promise<crypto.KeyObject | null> {
    const age = this.now() - this.fetchedAt;
    const known = this.keys.get(kid);
    if (known && age < KEYS_TTL_MS) return known;
    if (!known && this.fetchedAt !== 0 && age < REFETCH_MIN_MS) return null;
    try {
      await this.refresh();
    } catch {
      return known ?? null;
    }
    return this.keys.get(kid) ?? null;
  }

  /** The verified email of a token, or null for anything that does not check out. */
  async verify(token: string): Promise<AccessIdentity | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts as [string, string, string];
    const header = b64urlJson(head);
    const payload = b64urlJson(body);
    if (!header || !payload) return null;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    const key = await this.keyFor(header.kid);
    if (!key) return null;
    let signed = false;
    try {
      signed = crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${head}.${body}`),
        key,
        Buffer.from(sig, 'base64url')
      );
    } catch {
      signed = false;
    }
    if (!signed) return null;

    const now = this.now();
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now - SKEW_MS) return null;
    if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now + SKEW_MS) return null;
    if (payload.iss !== this.issuer) return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.some(a => typeof a === 'string' && this.config.audiences.includes(a))) return null;
    if (typeof payload.email !== 'string' || !payload.email.includes('@')) return null;
    return { email: payload.email.trim().toLowerCase() };
  }
}
