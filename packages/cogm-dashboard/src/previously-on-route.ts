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
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

/** The narration script, found from this file (src/ or dist/), not from the working directory. */
const NARRATE_TOOL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'tools',
  'narration',
  'narrate.ps1'
);

/** Runs a script while holding the GPU lock (`scripts/gpu-lock-run.ps1`). */
const GPU_LOCK_RUN = resolve(NARRATE_TOOL, '..', '..', '..', 'scripts', 'gpu-lock-run.ps1');

/** Short fingerprint of the recap text: a new text gets its own folder, so a voice is never stale. */
function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/** One folder per text and language: `<notes>/.previously-on/<hash>`. */
function renderDir(recap: ApprovedRecap, text: string): string {
  return join(recap.dir, '.previously-on', hashOf(text));
}

/** Where narrate puts the finished file: `<out>/<script name>/<script name>.wav`. */
function wavPath(out: string, lang: PreviouslyOnLang): string {
  return join(out, `previously-on.${lang}`, `previously-on.${lang}.wav`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Removes render folders whose text is no longer the current recap, so they do not pile up. */
async function pruneOldRenders(recap: ApprovedRecap): Promise<void> {
  const root = join(recap.dir, '.previously-on');
  const keep = new Set(Object.values(recap.text).map(hashOf));
  try {
    for (const name of await readdir(root)) {
      if (!keep.has(name)) await rm(join(root, name), { recursive: true, force: true });
    }
  } catch {
    // nothing to prune yet
  }
}

/** The recap as chat HTML: one paragraph per block, text escaped. */
function chatHtml(text: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function defaultNarrate(scriptPath: string, outDir: string): Promise<void> {
  return new Promise((done, fail) => {
    if (!existsSync(NARRATE_TOOL)) {
      fail(new Error(`narrate.ps1 not found at ${NARRATE_TOOL}`));
      return;
    }
    if (!existsSync(GPU_LOCK_RUN)) {
      fail(new Error(`gpu-lock-run.ps1 not found at ${GPU_LOCK_RUN}`));
      return;
    }
    // The voice runs on the GPU: it goes through the GPU lock wrapper, which refuses with a message
    // naming the holder when another GPU job is running, and releases the lock when narrate ends.
    const child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        GPU_LOCK_RUN,
        '-Holder',
        'Previously on narration',
        '-Purpose',
        'Previously on voice',
        '-Script',
        NARRATE_TOOL,
        '-ArgsJson',
        JSON.stringify(['make', scriptPath, '--out', outDir]),
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let refusal = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      refusal = (refusal + chunk.toString()).slice(-400);
    });
    const timer = setTimeout(() => {
      // On Windows kill() only ends pwsh, not the python it started: end the whole tree.
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          ...SILENT,
        }).on('error', () => child.kill());
      } else {
        child.kill();
      }
      fail(new Error('narrate timed out'));
    }, RENDER_TIMEOUT_MS);
    child.on('error', error => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) done();
      else if (code === 1 && refusal.includes('The GPU is in use')) fail(new Error(refusal.trim()));
      else fail(new Error(`narrate exited ${code}`));
    });
  });
}

export function mountPreviouslyOnRoute(app: Express, options: PreviouslyOnOptions): void {
  const { client, requireGm, gmActionsEnabled, enabled } = options;
  const dirOf = (): string => options.sessionsDir ?? sessionsDirFrom(process.env.FVTT_SESSIONS_DIR);
  const narrate = options.narrate ?? defaultNarrate;
  const parseBody = express.json({ limit: 1024 });
  const rendering = new Set<string>();
  /** Voices that failed since the dashboard started (cleared when tried again). */
  const failed = new Set<string>();

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

  /** The finished voice for the recap's current text, or null. */
  async function audioFor(recap: ApprovedRecap, lang: PreviouslyOnLang): Promise<string | null> {
    const text = recap.text[lang];
    if (!text) return null;
    const wav = wavPath(renderDir(recap, text), lang);
    return (await exists(wav)) ? wav : null;
  }

  app.get('/api/previously-on', requireGm, (_req, res) => {
    if (!enabled()) {
      res.json({
        enabled: false,
        session: null,
        languages: [],
        audio: {},
        rendering: [],
        failed: [],
      });
      return;
    }
    void (async (): Promise<void> => {
      const recap = await readApprovedRecap(dirOf());
      const audio: Record<string, boolean> = {};
      if (recap) {
        for (const lang of PREVIOUSLY_ON_LANGS) {
          audio[lang] = (await audioFor(recap, lang)) !== null;
        }
      }
      // A failed voice stops showing once that language has a voice (key is `session:lang`).
      const stillFailed = [...failed].filter(
        key =>
          recap !== null &&
          key.startsWith(`${recap.session}:`) &&
          !audio[key.slice(key.lastIndexOf(':') + 1)]
      );
      res.json({
        enabled: true,
        session: recap?.session ?? null,
        languages: recap ? Object.keys(recap.text) : [],
        audio,
        rendering: [...rendering],
        failed: stillFailed,
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
      if (text.length > CHAT_MAX) {
        res.status(413).json({
          error: { message: 'The recap is too long for one chat post.', code: 'too-long' },
        });
        return;
      }
      await client.callTool('send-chat-message', {
        message: chatHtml(text),
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
      // Marked before any await, so a second request in the same moment does not start a second run.
      rendering.add(key);
      failed.delete(key);
      const out = renderDir(recap, text);
      try {
        await pruneOldRenders(recap);
        await mkdir(out, { recursive: true });
        const script = join(out, `previously-on.${lang}.md`);
        await writeFile(script, `${text}\n`, 'utf-8');
        narrate(script, out)
          .catch((error: unknown) => {
            failed.add(key);
            options.logger?.warn('Previously on narration failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => rendering.delete(key));
      } catch (error) {
        rendering.delete(key);
        throw error;
      }
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
      const wav = recap ? await audioFor(recap, lang) : null;
      if (!wav) {
        res.status(404).json({ error: { message: 'No audio yet.' } });
        return;
      }
      res.type('audio/wav').sendFile(resolve(wav), { dotfiles: 'allow' });
    })().catch(() => res.status(500).json({ error: { message: 'Could not read the audio.' } }));
  });
}
