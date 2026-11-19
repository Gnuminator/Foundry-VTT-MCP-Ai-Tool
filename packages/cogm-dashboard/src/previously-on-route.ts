/**
 * "Previously on" (item previously-on): a GM button that posts last night's approved player recap
 * to chat in Danish or English and, when the narration tool is set up on this PC, plays it as a
 * spoken cold open in the GM's browser. Off by default (`FOUNDRY_AI_PREVIOUSLY_ON=1` turns it on).
 *
 * The text comes from the sessions folder next to the bridge (`<session>/notes/recap.player.<lang>.md`,
 * the newest session with an `approved.json`), the same folder the session notes card reads. Nothing
 * here reaches /player and no AI is called: the voice is the local narration tool.
 *
 * - `GET  /api/previously-on`              -> `{enabled, session, languages, audio}` (GM)
 * - `POST /api/previously-on`              -> posts the text to chat (GM + GM Actions); body `{lang}`
 * - `POST /api/previously-on/audio`        -> voices it (GM + GM Actions); body `{lang}`; 202, then
 *                                             poll the GET until `audio[lang]` is true
 * - `GET  /api/previously-on/audio/:lang`  -> the WAV (GM)
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { sessionsDirFrom } from '@gnuminator/shared';
import express, { type Express, type Request, type Response } from 'express';

import type { Logger } from './logger.js';

const PREVIOUSLY_ON_LANGS = ['da', 'en'] as const;
type PreviouslyOnLang = (typeof PREVIOUSLY_ON_LANGS)[number];

interface PreviouslyOnClient {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

interface PreviouslyOnOptions {
  client: PreviouslyOnClient;
  requireGm: (req: Request, res: Response, next: () => void) => void;
  gmActionsEnabled: () => boolean;
  /** The switch; off by default. */
  enabled: () => boolean;
  sessionsDir?: string;
  /** Runs the narration tool for one script file; default spawns `narrate.ps1` (tests inject). */
  narrate?: (scriptPath: string, outDir: string) => Promise<void>;
  logger?: Logger;
}

interface ApprovedRecap {
  session: string;
  dir: string;
  text: Partial<Record<PreviouslyOnLang, string>>;
}

/** The recap file's text for speaking and chat: no title line, no draft quote, no markdown marks. */
export function recapPlainText(markdown: string): string {
  const lines = markdown
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => !/^\s*#/.test(line) && !/^\s*>/.test(line));
  return lines
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/^[ \t]*[-*][ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The newest session folder that is approved and has at least one recap file; null otherwise. */
async function readApprovedRecap(dir: string): Promise<ApprovedRecap | null> {
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const name of names) {
    const notes = join(dir, name, 'notes');
    try {
      await stat(join(notes, 'approved.json'));
    } catch {
      continue;
    }
    const text: ApprovedRecap['text'] = {};
    for (const lang of PREVIOUSLY_ON_LANGS) {
      try {
        const plain = recapPlainText(
          await readFile(join(notes, `recap.player.${lang}.md`), 'utf-8')
        );
        if (plain) text[lang] = plain;
      } catch {
        // no recap in this language
      }
    }
    // Only the newest approved session counts: last night's, not an older one.
    return Object.keys(text).length > 0 ? { session: name, dir: notes, text } : null;
  }
  return null;
}

const CHAT_MAX = 4000;
/** The narration tool's own output goes nowhere (its WAV is what counts). */
const SILENT = { stdio: 'ignore' } as const;

async function findWav(dir: string): Promise<string | null> {
  try {
    const hit = (await readdir(dir)).find(f => f.toLowerCase().endsWith('.wav'));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

function defaultNarrate(scriptPath: string, outDir: string): Promise<void> {
  const tool = resolve(process.cwd(), 'tools', 'narration', 'narrate.ps1');
  return new Promise((done, fail) => {
    const child = spawn(
      'pwsh',
      ['-NoProfile', '-File', tool, 'make', scriptPath, '--out', outDir],
      { windowsHide: true, ...SILENT }
    );
    child.on('error', fail);
    child.on('exit', code => (code === 0 ? done() : fail(new Error(`narrate exited ${code}`))));
  });
}

export function mountPreviouslyOnRoute(app: Express, options: PreviouslyOnOptions): void {
  const { client, requireGm, gmActionsEnabled, enabled } = options;
  const dirOf = (): string => options.sessionsDir ?? sessionsDirFrom(process.env.FVTT_SESSIONS_DIR);
  const narrate = options.narrate ?? defaultNarrate;
  const parseBody = express.json({ limit: 1024 });
  const rendering = new Set<string>();

  const langOf = (value: unknown): PreviouslyOnLang | null =>
    PREVIOUSLY_ON_LANGS.find(l => l === value) ?? null;

  function gate(_req: Request, res: Response, next: () => void): void {
    if (!enabled()) {
      res.status(403).json({
        error: { message: 'Previously on is off.', code: 'feature-off' },
      });
      return;
    }
    if (!gmActionsEnabled()) {
      res.status(403).json({
        error: {
          message: 'GM Actions are off. Turn on the GM Actions switch to change the game.',
          code: 'gm-actions-disabled',
        },
      });
      return;
    }
    next();
  }

  const audioDir = (recap: ApprovedRecap, lang: PreviouslyOnLang): string =>
    join(recap.dir, '.previously-on', `previously-on.${lang}`);

  app.get('/api/previously-on', requireGm, (_req, res) => {
    if (!enabled()) {
      res.json({ enabled: false, session: null, languages: [], audio: {}, rendering: [] });
      return;
    }
    void (async (): Promise<void> => {
      const recap = await readApprovedRecap(dirOf());
      const audio: Record<string, boolean> = {};
      if (recap) {
        for (const lang of PREVIOUSLY_ON_LANGS) {
          audio[lang] = (await findWav(audioDir(recap, lang))) !== null;
        }
      }
      res.json({
        enabled: true,
        session: recap?.session ?? null,
        languages: recap ? Object.keys(recap.text) : [],
        audio,
        rendering: [...rendering],
      });
    })().catch(() => res.status(500).json({ error: { message: 'Could not read the recap.' } }));
  });

  app.post('/api/previously-on', requireGm, gate, parseBody, (req, res) => {
    const lang = langOf((req.body as { lang?: unknown } | undefined)?.lang);
    if (!lang) {
      res.status(400).json({ error: { message: 'lang must be da or en.', code: 'bad-request' } });
      return;
    }
    void (async (): Promise<void> => {
      const recap = await readApprovedRecap(dirOf());
      const text = recap?.text[lang];
      if (!recap || !text) {
        res.status(404).json({
          error: { message: 'No approved recap in that language yet.', code: 'not-found' },
        });
        return;
      }
      await client.callTool('send-chat-message', {
        message: text.slice(0, CHAT_MAX),
        messageType: 'ooc',
      });
      res.json({ ok: true, session: recap.session, lang });
    })().catch((error: unknown) => {
      options.logger?.warn('Previously on chat post failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({
        error: { message: 'Could not post to chat. Is Foundry open?', code: 'bridge-unreachable' },
      });
    });
  });

  app.post('/api/previously-on/audio', requireGm, gate, parseBody, (req, res) => {
    const lang = langOf((req.body as { lang?: unknown } | undefined)?.lang);
    if (!lang) {
      res.status(400).json({ error: { message: 'lang must be da or en.', code: 'bad-request' } });
      return;
    }
    void (async (): Promise<void> => {
      const recap = await readApprovedRecap(dirOf());
      const text = recap?.text[lang];
      if (!recap || !text) {
        res.status(404).json({
          error: { message: 'No approved recap in that language yet.', code: 'not-found' },
        });
        return;
      }
      const key = `${recap.session}:${lang}`;
      if (rendering.has(key)) {
        res.status(202).json({ ok: true, rendering: true });
        return;
      }
      const out = join(recap.dir, '.previously-on');
      await mkdir(out, { recursive: true });
      const script = join(out, `previously-on.${lang}.md`);
      await writeFile(script, `${text}\n`, 'utf-8');
      rendering.add(key);
      narrate(script, out)
        .catch((error: unknown) =>
          options.logger?.warn('Previously on narration failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        )
        .finally(() => rendering.delete(key));
      res.status(202).json({ ok: true, rendering: true });
    })().catch(() => res.status(500).json({ error: { message: 'Could not start the voice.' } }));
  });

  app.get('/api/previously-on/audio/:lang', requireGm, (req, res) => {
    const lang = langOf(req.params.lang);
    if (!enabled() || !lang) {
      res.status(404).json({ error: { message: 'No audio.' } });
      return;
    }
    void (async (): Promise<void> => {
      const recap = await readApprovedRecap(dirOf());
      const wav = recap ? await findWav(audioDir(recap, lang)) : null;
      if (!wav) {
        res.status(404).json({ error: { message: 'No audio yet.' } });
        return;
      }
      res.type('audio/wav').sendFile(resolve(wav), { dotfiles: 'allow' });
    })().catch(() => res.status(500).json({ error: { message: 'Could not read the audio.' } }));
  });
}
