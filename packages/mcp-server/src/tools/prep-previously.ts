/**
 * "Previously on" for `get-prep-digest`: the GM summary of the newest recorded session that has
 * one. The voice pipeline (tools/session-notes) writes `<sessions>/<session>-discord/notes/` (a
 * restart in the same minute is `<session>-discord-2`, `-3` and so on; the highest is newest) with
 * `summary.<lang>.md` for the GM, plus a player recap draft and transcripts. Only
 * `summary.en.md` and `summary.da.md` are ever opened here: never the recap draft
 * (`recap.player.*.md`) and never a transcript.
 *
 * The sessions folder sits on the PC that records (FVTT_SESSIONS_DIR, else
 * Documents/FoundrySessions). A bridge on another host cannot see it, and then says so.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { PREP_PREVIOUSLY_MAX_CHARS, type PrepPreviously } from '@gnuminator/shared';

/** Session folders the recorder makes end in this. */
const SESSION_FOLDER = /-discord(?:-\d+)?$/;
/** A summary file larger than this is skipped unread (a real one is a few KB). */
const MAX_SUMMARY_BYTES = 64 * 1024;
/** The digest is English: English first, then Danish when only that one was written. */
const LANGS = ['en', 'da'] as const;
/** Newest session folders looked at for a written summary. */
const MAX_SESSIONS_LOOKED_AT = 20;
/**
 * The placeholder body the pipeline writes when the summary is not written yet
 * (tools/session-notes render.py, HEAD[lang]["missing"]).
 */
const NOT_WRITTEN = new Set([
  'Not written yet (run session-notes again).',
  'Ikke skrevet endnu (kør session-notes igen).',
]);
/** The summary heading, "# Summary: <title>" or "# Resumé: <title>". */
const HEADING = /^#\s+(?:Summary|Resumé)\s*(?::\s*(.*))?$/;

interface ParsedSummary {
  title: string | null;
  body: string;
}

/** A byte order mark, which a Windows editor may put at the start of the file. */
const BOM = String.fromCharCode(0xfeff);

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function parseSummary(raw: string): ParsedSummary | null {
  const lines = stripBom(raw).replace(/\r\n?/g, '\n').split('\n');
  let title: string | null = null;
  const first = lines.findIndex(l => l.trim() !== '');
  if (first >= 0) {
    const match = HEADING.exec(lines[first].trim());
    if (match) {
      title = match[1]?.trim() || null;
      lines.splice(first, 1);
    }
  }
  const body = lines.join('\n').trim();
  if (!body || NOT_WRITTEN.has(body)) return null;
  return { title, body };
}

/** Cut at the last line end before `max` characters (or at `max` when one line is longer). */
function cap(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('\n');
  return { text: (end > max / 2 ? cut.slice(0, end) : cut).trimEnd(), truncated: true };
}

/**
 * Newest first: the folder name starts with the date and time, then a restart in the same minute
 * adds `-N`, which is compared as a number (`-discord-10` is newer than `-discord-9`).
 */
function newestFirst(a: string, b: string): number {
  const split = (name: string): [string, number] => {
    const m = /^(.*-discord)(?:-(\d+))?$/.exec(name);
    return m ? [m[1], m[2] ? Number(m[2]) : 0] : [name, 0];
  };
  const [baseA, restartA] = split(a);
  const [baseB, restartB] = split(b);
  if (baseA !== baseB) return baseA < baseB ? 1 : -1;
  return restartB - restartA;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Read "Previously on" from `sessionsDir`. Never throws: a folder this process cannot read is
 * `unreachable`, a folder without a written summary is `none`.
 */
export async function readPreviously(sessionsDir: string): Promise<PrepPreviously> {
  let names: string[];
  try {
    names = (await readdir(sessionsDir, { withFileTypes: true }))
      .filter(e => e.isDirectory() && SESSION_FOLDER.test(e.name))
      .map(e => e.name)
      .sort(newestFirst);
  } catch (error) {
    const code = errorCode(error);
    const why =
      code === 'ENOENT'
        ? 'it does not exist here'
        : code === 'EACCES' || code === 'EPERM'
          ? 'access was refused'
          : 'it could not be read';
    return {
      status: 'unreachable',
      sessionsDir,
      note: `No "Previously on": the bridge cannot see the session notes folder ${sessionsDir} (${why}). The bridge may run on another computer than the recordings; set FVTT_SESSIONS_DIR for the bridge if the folder is somewhere else.`,
    };
  }

  // Folder names start with the date, so the newest sorts last; look at the newest few only.
  for (const session of names.slice(0, MAX_SESSIONS_LOOKED_AT)) {
    for (const lang of LANGS) {
      let raw: string;
      try {
        const file = join(sessionsDir, session, 'notes', `summary.${lang}.md`);
        if ((await stat(file)).size > MAX_SUMMARY_BYTES) continue;
        raw = await readFile(file, 'utf-8');
      } catch {
        continue;
      }
      const parsed = parseSummary(raw);
      if (!parsed) continue;
      const { text, truncated } = cap(parsed.body, PREP_PREVIOUSLY_MAX_CHARS);
      const language = lang === 'en' ? 'English' : 'Danish';
      return {
        status: 'found',
        sessionsDir,
        session,
        lang,
        title: parsed.title,
        text,
        truncated,
        note: `Previously on: the ${language} GM summary of ${session}${truncated ? ', shortened' : ''}.`,
      };
    }
  }

  return {
    status: 'none',
    sessionsDir,
    note:
      names.length === 0
        ? `No "Previously on": there is no recorded session in ${sessionsDir} yet.`
        : `No "Previously on": no recorded session in ${sessionsDir} has a GM summary yet (run session-notes for the newest one).`,
  };
}
