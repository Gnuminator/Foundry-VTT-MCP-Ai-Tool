/**
 * "My character" (I-096): the player's own page and the GM's per-player links.
 *
 * - `GET  /me`                          -> the page (static `me.html`, the players' page CSP)
 * - `GET  /api/me`                      -> the sheets of the characters the player owns; the
 *                                          player's private key comes in the `X-CoGM-Me` header
 *                                          (the page moves it out of the address bar at once,
 *                                          so it never lands in a log or the browser history)
 * - `POST /api/me/roll`                -> the player rolls one of their open roll requests (the body
 *                                          carries the button id; the module rolls for their character
 *                                          from the GM client and checks the request is theirs)
 * - `POST /api/me/portrait`            -> the player puts their own picture on a character they own
 *                                          (raw image body; the module stores it in their own folder)
 * - `GET  /api/player-links`            -> GM: each player, with their link if they have one
 * - `GET  /api/party-sheets`            -> GM: the sheets of every player's characters, for the paper
 *                                          night print (`party-print.html`)
 * - `POST /api/player-links/:userId`    -> GM: make a new link (the old one stops working)
 * - `DELETE /api/player-links/:userId`  -> GM: remove the player's link
 *
 * The key maps to a Foundry user id on this side only; the bridge's control method
 * `character_sheet` then returns only the character actors that user OWNS.
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { PORTRAIT_MAX_BYTES, sniffPortraitType } from '@gnuminator/shared';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { SessionEvent } from './feed/types.js';
import type { Logger } from './logger.js';
import type { PlayerLinkStore } from './player-links.js';
import { privateRollsFor } from './private-rolls.js';
import type { PlayerDirectory } from './usage-route.js';

export interface MeClient {
  characterSheet?(userId: string): Promise<unknown>;
  playerRoll?(userId: string, buttonId: string): Promise<unknown>;
  playerPortrait?(
    userId: string,
    actorId: string,
    target: 'portrait' | 'both',
    data: string
  ): Promise<unknown>;
  /** The feature cards; read here only for the `player-portrait` switch. */
  featureSwitches?(): Promise<unknown>;
}

export interface MeRouteOptions {
  client: MeClient;
  links: PlayerLinkStore;
  directory: PlayerDirectory;
  requireGm: (req: Request, res: Response, next: () => void) => void;
  /** For a failed link save or removal (the reply to the GM is a fixed sentence). */
  logger?: Pick<Logger, 'warn'>;
  /** The player connector's login table (D-136), or null when the connector is off. */
  connector?: Pick<import('./player-connector.js').ConnectorStore, 'credentialsFor'> | null;
  /** Builds one player's extension file; the real one loads tools/player-connector. For tests. */
  buildPreset?: (p: PresetInput) => Buffer | Promise<Buffer>;
  /** The connected world, or null before it is known. */
  worldId: () => string | null;
  /** The recent session events, for the player's own private rolls; absent on fakes. */
  events?: () => readonly SessionEvent[];
  /** Called after a player's roll went through, so the GM's roll bar updates at once. */
  onRolled?: () => void;
  /** The GM's theme for this world (the Fancy view follows it). */
  theme: () => string;
  publicDir: string;
  pageHeaders: (res: Response) => void;
}

export interface PresetInput {
  endpoint: string;
  clientId: string;
  clientSecret: string;
  playerName: string;
  userId: string;
}

/** The real builder: tools/player-connector/build.mjs, three folders above dist/ (or src/). */
async function loadPresetBuilder(p: PresetInput): Promise<Buffer> {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'tools',
    'player-connector',
    'build.mjs'
  );
  const mod = (await import(pathToFileURL(file).href)) as {
    buildPreset: (input: PresetInput) => Buffer;
  };
  return mod.buildPreset(p);
}

const ME_KEY_HEADER = 'x-cogm-me';
const USER_ID = /^[A-Za-z0-9]{16}$/;
const BUTTON_ID = /^[A-Za-z0-9]{16}$/;

/** The open roll requests, reduced to the button id and its text (nothing else reaches the page). */
function openRollRequests(result: unknown): Array<{ buttonId: string; label: string }> {
  const list = (result as { rollRequests?: unknown } | null)?.rollRequests;
  if (!Array.isArray(list)) return [];
  const out: Array<{ buttonId: string; label: string }> = [];
  for (const r of list as unknown[]) {
    const { buttonId, label } = (r ?? {}) as { buttonId?: unknown; label?: unknown };
    if (typeof buttonId === 'string' && BUTTON_ID.test(buttonId) && typeof label === 'string') {
      out.push({ buttonId, label: label.slice(0, 80) });
    }
  }
  return out.slice(0, 8);
}

export function mountMeRoute(app: Express, options: MeRouteOptions): void {
  const { client, links, directory, requireGm, worldId } = options;

  // The flag is read from the bridge at most every 20 s (the page asks on every refresh).
  const FLAG_TTL_MS = 20_000;
  let flagCache: { at: number; value: boolean | null } | null = null;
  function portraitFlag(): Promise<boolean | null> {
    if (typeof client.featureSwitches !== 'function') return Promise.resolve(null);
    if (flagCache && Date.now() - flagCache.at < FLAG_TTL_MS) {
      return Promise.resolve(flagCache.value);
    }
    return client
      .featureSwitches()
      .then(raw => {
        const r = raw as { features?: unknown; writesAllowed?: unknown } | null;
        const entry = Array.isArray(r?.features)
          ? (r.features as Array<{ id?: unknown; enabled?: unknown }>).find(
              f => f.id === 'player-portrait'
            )
          : undefined;
        const value =
          entry && typeof entry.enabled === 'boolean'
            ? entry.enabled && r?.writesAllowed !== false
            : null;
        flagCache = { at: Date.now(), value };
        return value;
      })
      .catch(() => null);
  }

  app.get('/me', (_req: Request, res: Response) => {
    options.pageHeaders(res);
    res.sendFile('me.html', { root: options.publicDir });
  });

  app.get('/api/me', (req: Request, res: Response) => {
    const world = worldId();
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const userId = world ? links.userFor(world, key) : null;
    if (!userId) {
      res
        .status(401)
        .json({ code: 'no-link', error: 'This link is not valid. Ask your GM for a new one.' });
      return;
    }
    if (typeof client.characterSheet !== 'function') {
      res.status(501).json({ error: 'Your sheet is not available here. Ask your GM.' });
      return;
    }
    // Is "Player portraits" on, and are writes allowed at all? The page hides the upload control
    // when either is off. null when the bridge cannot say (an old backend): the page keeps the
    // control and the refusal explains.
    const portraitEnabled = portraitFlag();
    Promise.all([client.characterSheet(userId), portraitEnabled])
      .then(([result, portraitOn]) =>
        res.json({
          ...(result as object),
          rollRequests: openRollRequests(result),
          theme: options.theme(),
          privateRolls: options.events ? privateRollsFor(userId, options.events()) : [],
          portraitEnabled: portraitOn,
        })
      )
      .catch(() => {
        res
          .status(502)
          .json({ error: 'Could not read your character. Wait a moment and try again.' });
      });
  });

  // "Your Claude connector" (D-136): the caller's own Client ID and Secret, never anyone else's.
  // The pair is chosen by the user the private key maps to; there is no way to name another.
  app.get('/api/me/connector', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const world = worldId();
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const userId = world ? links.userFor(world, key) : null;
    if (!userId) {
      res
        .status(401)
        .json({ code: 'no-link', error: 'This link is not valid. Ask your GM for a new one.' });
      return;
    }
    const own = options.connector?.credentialsFor(userId) ?? null;
    if (!own) {
      res.json({ enabled: false });
      return;
    }
    res.json({
      enabled: true,
      endpoint: own.endpoint,
      clientId: own.clientId,
      clientSecret: own.clientSecret,
    });
  });

  // "Download my helper": the player's own extension file, built for this request from the generic
  // template with their pair as literals (tools/player-connector). The key goes in a header like
  // every /me call, so the page fetches it and saves the bytes; nothing is stored or logged here.
  app.get('/api/me/helper.mcpb', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const world = worldId();
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const userId = world ? links.userFor(world, key) : null;
    if (!userId) {
      res
        .status(401)
        .json({ code: 'no-link', error: 'This link is not valid. Ask your GM for a new one.' });
      return;
    }
    const own = options.connector?.credentialsFor(userId) ?? null;
    if (!own) {
      res.status(404).json({ error: 'There is no helper set up for you yet. Ask your GM.' });
      return;
    }
    if (!own.endpoint) {
      res.status(503).json({ error: 'The helper address is not set yet. Ask your GM.' });
      return;
    }
    const build = options.buildPreset ?? loadPresetBuilder;
    void directory
      .refreshIfStale()
      .catch(() => undefined)
      .then(() =>
        build({
          endpoint: own.endpoint as string,
          clientId: own.clientId,
          clientSecret: own.clientSecret,
          playerName: directory.get(userId)?.name ?? '',
          userId,
        })
      )
      .then(bytes => {
        res.set({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="foundry-player.mcpb"',
          'Content-Length': String(bytes.length),
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(bytes);
      })
      .catch(() => {
        // Never the error text: it could carry a value. A fixed sentence only.
        res.status(503).json({ error: 'Could not make your helper file. Ask your GM.' });
      });
  });

  // One roll at a time per player: a second press while the first is rolling is refused.
  const rolling = new Set<string>();
  app.post('/api/me/roll', (req: Request, res: Response) => {
    const world = worldId();
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const userId = world ? links.userFor(world, key) : null;
    if (!userId) {
      res
        .status(401)
        .json({ code: 'no-link', error: 'This link is not valid. Ask your GM for a new one.' });
      return;
    }
    const buttonId = (req.body as { buttonId?: unknown } | undefined)?.buttonId;
    if (typeof buttonId !== 'string' || !BUTTON_ID.test(buttonId)) {
      res.status(400).json({ error: 'Not a roll request.' });
      return;
    }
    if (typeof client.playerRoll !== 'function') {
      res.status(501).json({ error: 'Rolling from this page is not available. Roll in Foundry.' });
      return;
    }
    if (rolling.has(userId)) {
      res.status(429).json({ error: 'Your last roll is still going.' });
      return;
    }
    rolling.add(userId);
    client
      .playerRoll(userId, buttonId)
      .then(result => {
        const r = (result ?? {}) as { success?: unknown; message?: unknown; error?: unknown };
        if (r.success === true) {
          res.json({ ok: true, message: typeof r.message === 'string' ? r.message : 'Rolled.' });
          options.onRolled?.();
        } else {
          res.status(409).json({
            error: typeof r.error === 'string' ? r.error : 'The roll did not work.',
          });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        // The module's switch for writes is off: say so in table words, not settings words.
        const writesOff = /Write operations are disabled/i.test(message);
        // 409 for the writes-off case so the page shows this line; other failures stay 502.
        res.status(writesOff ? 409 : 502).json({
          error: writesOff
            ? 'Rolling from this page is switched off right now. Roll in Foundry, or ask your GM.'
            : 'Could not roll. Ask your GM.',
        });
      })
      .finally(() => rolling.delete(userId));
  });

  // "Upload my portrait": the body is the picture itself (raw bytes), `actor` the character's id,
  // `target` `portrait` or `both` (also the prototype token). The identity is the player's private
  // key, so a player can only ever change a character they own (the module checks the ownership
  // again). The type is read from the bytes, never from the name or the sent type; the folder and
  // the file name are made on the other side, nothing here names a path.
  const uploading = new Set<string>();
  const portraitBody = express.raw({ type: () => true, limit: PORTRAIT_MAX_BYTES });
  app.post('/api/me/portrait', (req: Request, res: Response, next: NextFunction) => {
    const world = worldId();
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const userId = world ? links.userFor(world, key) : null;
    if (!userId) {
      res
        .status(401)
        .json({ code: 'no-link', error: 'This link is not valid. Ask your GM for a new one.' });
      return;
    }
    portraitBody(req, res, (err?: unknown) => {
      if (err) {
        const tooBig = (err as { type?: string }).type === 'entity.too.large';
        res.status(tooBig ? 413 : 400).json({
          error: tooBig ? 'That picture is too big. The limit is 5 MB.' : 'Not a picture.',
        });
        return;
      }
      void handlePortrait(req, res, userId).catch(next);
    });
  });

  async function handlePortrait(req: Request, res: Response, userId: string): Promise<void> {
    const actorId = typeof req.query.actor === 'string' ? req.query.actor : '';
    const target = req.query.target === 'both' ? 'both' : 'portrait';
    if (!USER_ID.test(actorId)) {
      res.status(400).json({ error: 'Pick a character.' });
      return;
    }
    // express.raw gives a Buffer; copy it into our own so no request value reaches the checks.
    const sent: unknown = req.body;
    const bytes = sent instanceof Uint8Array ? Buffer.from(sent) : null;
    if (!bytes || bytes.length === 0) {
      res.status(400).json({ error: 'Pick a picture first.' });
      return;
    }
    if (bytes.length > PORTRAIT_MAX_BYTES) {
      res.status(413).json({ error: 'That picture is too big. The limit is 5 MB.' });
      return;
    }
    if (!sniffPortraitType(bytes)) {
      res.status(415).json({ error: 'Only PNG, JPG or WebP pictures work.' });
      return;
    }
    if (typeof client.playerPortrait !== 'function') {
      res
        .status(501)
        .json({ error: 'Changing your picture from this page is not available here.' });
      return;
    }
    if (uploading.has(userId)) {
      res.status(429).json({ error: 'Your last picture is still being saved.' });
      return;
    }
    uploading.add(userId);
    try {
      const result = (await client.playerPortrait(
        userId,
        actorId,
        target,
        bytes.toString('base64')
      )) as { path?: unknown; actorName?: unknown };
      res.json({
        ok: true,
        path: typeof result?.path === 'string' ? result.path : '',
        actorName: typeof result?.actorName === 'string' ? result.actorName : '',
      });
      options.onRolled?.();
    } catch (error) {
      // Only a refusal the player can act on (not yours, too big, switched off) is shown as it is.
      const code = (error as { code?: unknown }).code;
      if (code === 'portrait' && error instanceof Error) {
        res.status(409).json({ error: error.message });
      } else {
        res.status(502).json({ error: 'Could not save your picture. Ask your GM.' });
      }
    } finally {
      uploading.delete(userId);
    }
  }

  app.get('/api/player-links', requireGm, (_req: Request, res: Response) => {
    const world = worldId();
    void directory
      .refreshIfStale()
      .catch(() => undefined)
      .then(() => {
        const byUser = new Map((world ? links.list(world) : []).map(l => [l.userId, l]));
        res.json({
          players: directory.list().map(p => {
            const link = byUser.get(p.userId);
            return {
              userId: p.userId,
              name: p.name,
              link: link ? `/me?k=${link.key}` : null,
              createdAt: link?.createdAt ?? null,
            };
          }),
        });
      });
  });

  // The GM's party print (paper-print): the sheets of every player's characters in one answer.
  // GM only; a player's own link still gets only their own sheets from /api/me. A character two
  // players own shows once, under the first owner.
  app.get('/api/party-sheets', requireGm, (_req: Request, res: Response) => {
    if (typeof client.characterSheet !== 'function') {
      res.status(501).json({ error: 'This bridge cannot read character sheets.' });
      return;
    }
    const read = client.characterSheet.bind(client);
    void directory
      .refreshIfStale()
      .catch(() => undefined)
      .then(async () => {
        const seen = new Set<string>();
        const sheets: Array<Record<string, unknown> & { player: string }> = [];
        const unreadable: string[] = [];
        for (const player of directory.list()) {
          try {
            const result = (await read(player.userId)) as { sheets?: unknown };
            for (const sheet of Array.isArray(result?.sheets) ? result.sheets : []) {
              const s = sheet as Record<string, unknown>;
              const id = typeof s.id === 'string' ? s.id : null;
              if (id !== null && seen.has(id)) continue;
              if (id !== null) seen.add(id);
              sheets.push({ ...s, player: player.name });
            }
          } catch {
            unreadable.push(player.name);
          }
        }
        res.json({ sheets, unreadable });
      });
  });

  app.post('/api/player-links/:userId', requireGm, (req: Request, res: Response) => {
    const world = worldId();
    const userId = String(req.params.userId ?? '');
    if (!world || !USER_ID.test(userId) || !directory.get(userId)) {
      res.status(400).json({ error: 'Not a player of this world.' });
      return;
    }
    links
      .create(world, userId)
      .then(link => res.json({ userId, link: `/me?k=${link.key}`, createdAt: link.createdAt }))
      .catch((error: unknown) => {
        options.logger?.warn('Player link save failed', { userId, error: String(error) });
        res
          .status(500)
          .json({ error: 'Could not save the link. Ask the person running the tool.' });
      });
  });

  app.delete('/api/player-links/:userId', requireGm, (req: Request, res: Response) => {
    const world = worldId();
    const userId = String(req.params.userId ?? '');
    if (!world || !USER_ID.test(userId)) {
      res.status(400).json({ error: 'Not a player of this world.' });
      return;
    }
    links
      .remove(world, userId)
      .then(removed => res.json({ removed }))
      .catch((error: unknown) => {
        options.logger?.warn('Player link removal failed', { userId, error: String(error) });
        res
          .status(500)
          .json({ error: 'Could not remove the link. Ask the person running the tool.' });
      });
  });
}
