/**
 * Gzip for the React dashboard's hashed build files (I-098). Express sends them as they are, so a
 * first visit downloaded about 450 KB of JavaScript; gzip is about a third of that. Only the
 * content-hashed files under assets/ are covered (immutable, so one compressed copy per file is
 * enough and is kept in memory); everything else, the event stream included, goes untouched.
 */
import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { gzip } from 'zlib';

const gzipAsync = promisify(gzip);

const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
};

/** Below this the saving is not worth the header. */
const MIN_BYTES = 1024;

interface Compressed {
  body: Buffer;
  etag: string;
}

export interface GzipAssetsOptions {
  /** Cache-Control for the answer; default is the immutable one of the hashed build files. */
  cacheControl?: string;
  /** Only these extensions (lower case, with the dot); default .js and .css. */
  extensions?: readonly string[];
  /** Runs before the answer is sent, like express.static's setHeaders (page headers by file). */
  setHeaders?: (res: Response, filePath: string, stat: fs.Stats) => void;
}

/**
 * `res.json` for a big, per-request answer (/api/state): gzipped when the browser accepts it and
 * the body is worth it. Nothing is cached (the answer changes); Vary tells a proxy the two forms
 * differ. A failed compression falls back to the plain answer.
 */
export async function sendJsonGzip(req: Request, res: Response, payload: unknown): Promise<void> {
  const text = JSON.stringify(payload);
  res.vary('Accept-Encoding');
  res.type('application/json; charset=utf-8');
  if (Buffer.byteLength(text) < MIN_BYTES || req.acceptsEncodings('gzip', 'identity') !== 'gzip') {
    res.send(text);
    return;
  }
  try {
    const body = await gzipAsync(text, { level: 5 });
    if (res.headersSent) return;
    res.set({ 'Content-Encoding': 'gzip', 'Content-Length': String(body.length) });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    if (!res.headersSent) res.send(text);
  }
}

/** Serves `<assetsDir>/<file>` gzipped when the browser accepts it; otherwise falls through. */
export function gzipAssets(assetsDir: string, options: GzipAssetsOptions = {}) {
  const cacheControl = options.cacheControl ?? 'public, max-age=31536000, immutable';
  const root = path.resolve(assetsDir);
  // A promise per file, so parallel first requests compress it once.
  const cache = new Map<string, { mtimeMs: number; size: number; entry: Promise<Compressed> }>();

  const compress = async (file: string): Promise<Compressed> => {
    const body = await gzipAsync(await fs.promises.readFile(file), { level: 6 });
    const etag = `"${createHash('sha1').update(body).digest('base64url')}-gzip"`;
    return { body, etag };
  };

  const serve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ext = path.extname(req.path).toLowerCase();
      const type = options.extensions && !options.extensions.includes(ext) ? undefined : TYPES[ext];
      if ((req.method !== 'GET' && req.method !== 'HEAD') || !type) return next();
      if (req.headers.range || req.acceptsEncodings('gzip', 'identity') !== 'gzip') {
        return next();
      }
      const file = path.resolve(root, `.${decodeURIComponent(req.path)}`);
      if (!file.startsWith(root + path.sep)) return next();
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile() || stat.size < MIN_BYTES) return next();

      let hit = cache.get(file);
      if (hit?.mtimeMs !== stat.mtimeMs || hit.size !== stat.size) {
        const entry = compress(file);
        entry.catch(() => cache.delete(file));
        hit = { mtimeMs: stat.mtimeMs, size: stat.size, entry };
        cache.set(file, hit);
      }
      const { body, etag } = await hit.entry;
      res.set({
        'Content-Type': type,
        'Content-Encoding': 'gzip',
        ETag: etag,
        'Last-Modified': stat.mtime.toUTCString(),
        'Cache-Control': cacheControl,
      });
      options.setHeaders?.(res, file, stat);
      res.vary('Accept-Encoding');
      if (req.fresh) {
        res.status(304).end();
        return;
      }
      res.set('Content-Length', String(body.length));
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      next();
    }
  };
  return (req: Request, res: Response, next: NextFunction): void => {
    void serve(req, res, next);
  };
}
