/**
 * The git guard for licensed content in the GM's vault (docs/design/OBSIDIAN-O4-DESIGN.md
 * section 13.4). Licensed content (compendium and book text, D&D Beyond imports, their images)
 * may only ever be written where git will not pick it up. The guard answers three questions per
 * campaign folder, each failing closed on any git error:
 *
 * - `ok`: may the Library (`AI Tool/Library/`) and the image copies (`AI Tool/Attachments/`) be
 *   written? The guard keeps `Campaigns/<world>/AI Tool/.gitignore` with `/Library/` and
 *   `/Attachments/` (the GM's own lines kept), so this is true outside a repository and, inside
 *   one, when git confirms both folders are ignored and nothing in them is tracked. When git is
 *   not installed it trusts that `.gitignore` (a directory's own ignore rules always apply to its
 *   paths), but says that tracked files could not be checked.
 * - `licensedOk`: may world notes (`AI Tool/Foundry/`) carry licensed text and image embeds (NPC
 *   stat block features and biography, opted-in page text, portraits, maps)? True outside a
 *   repository; inside one only when git ignores the whole mirror folder `AI Tool/` and the vault
 *   trash for it (`.trash/Campaigns/<world>/AI Tool/`), and nothing under either is tracked. The
 *   guard never writes an ignore rule for the whole mirror folder: that is the GM's call. When
 *   git is missing, this is false.
 * - `trashOk`: may Library notes and images be moved to the vault trash? True outside a
 *   repository; inside one only when git ignores their trash folders and tracks nothing there.
 *
 * A `.git` anywhere inside `AI Tool/` (a nested repository) fails all three. The result is cached
 * for a few minutes; `reset()` forgets it.
 */
import { execFile } from 'child_process';
import { promises as fsp, type Dirent } from 'fs';
import * as path from 'path';

import { writeFileAtomic } from './atomic-write.js';
import { errorCode, errorMessage } from './note-writer.js';

/** Campaign-relative folders that hold licensed content. */
export const MIRROR_ROOT_FOLDER = 'AI Tool';
export const LIBRARY_ROOT = 'AI Tool/Library';
export const ATTACHMENTS_ROOT = 'AI Tool/Attachments';
/** The `.gitignore` the guard keeps (campaign-relative). */
export const LICENSED_GITIGNORE = 'AI Tool/.gitignore';
export const LICENSED_GITIGNORE_LINES: readonly string[] = ['/Library/', '/Attachments/'];
const GITIGNORE_HEADER =
  '# Written by the Foundry AI Tool: the Library and Attachments folders hold licensed\n' +
  '# compendium and book content and must never be committed to git.';

const CACHE_MS = 5 * 60_000;
const GIT_TIMEOUT_MS = 10_000;
/** The nested-repository search stops (and fails closed) past this many folders. */
const NESTED_MAX_DIRS = 5_000;
const NESTED_MAX_DEPTH = 12;

export interface GuardResult {
  /** The Library and image copies may be written. */
  ok: boolean;
  /** Why they may not (ok false), or a note (git missing). */
  reason: string | null;
  /** The repository root around the vault, or null. */
  repo: string | null;
  /** World notes may carry licensed text and image embeds. */
  licensedOk: boolean;
  /** Why world notes withhold licensed text (licensedOk false), or null. */
  licensedReason: string | null;
  /** Library notes and images may be moved to the vault trash. */
  trashOk: boolean;
  /** Why they stay in place instead (trashOk false), or null. */
  trashReason: string | null;
}

export type GitRunner = (
  args: string[],
  cwd: string
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** `git <args>` with a timeout; `code` -1 with stderr `ENOENT` when git is not installed. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise(resolve => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
          if (code === 'ENOENT') {
            resolve({ code: -1, stdout: '', stderr: 'ENOENT' });
            return;
          }
          resolve({
            code: typeof code === 'number' ? code : 1,
            stdout: String(stdout),
            stderr: String(stderr) || errorMessage(error),
          });
          return;
        }
        resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });

/** The nearest folder at or above `start` that holds `.git` (a folder or a worktree file). */
export async function findGitRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    const found = await fsp.lstat(path.join(current, '.git')).then(
      () => true,
      () => false
    );
    if (found) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * A `.git` (folder or file) anywhere below `root`, as a path relative to it; null when there is
 * none. Links are not followed. Throws when the search cannot finish (the caller fails closed).
 */
export async function findNestedGit(root: string): Promise<string | null> {
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
  let dirs = 0;
  while (queue.length > 0) {
    const { rel, depth } = queue.shift() as { rel: string; depth: number };
    dirs += 1;
    if (dirs > NESTED_MAX_DIRS) throw new Error(`more than ${NESTED_MAX_DIRS} folders to check`);
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(path.join(root, ...rel.split('/').filter(Boolean)), {
        withFileTypes: true,
      });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name === '.git') return child;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (depth + 1 > NESTED_MAX_DEPTH)
          throw new Error(`folders nested deeper than ${NESTED_MAX_DEPTH}`);
        queue.push({ rel: child, depth: depth + 1 });
      }
    }
  }
  return null;
}

/** The `.gitignore` text with our lines present (the GM's lines kept), or null when nothing is missing. */
export function completeGitignore(existing: string | null): string | null {
  const lines = (existing ?? '').replace(/\r\n/g, '\n').split('\n');
  const present = new Set(lines.map(line => line.trim()));
  const missing = LICENSED_GITIGNORE_LINES.filter(line => !present.has(line));
  if (missing.length === 0) return null;
  const base = (existing ?? '').replace(/\s+$/, '');
  const head = base === '' ? GITIGNORE_HEADER : `${base}\n\n${GITIGNORE_HEADER}`;
  return `${head}\n${missing.join('\n')}\n`;
}

/** What git said about one path or one command. */
type GitAnswer =
  | { state: 'yes' }
  | { state: 'no' }
  | { state: 'missing' }
  | { state: 'refused'; detail: string };

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line !== '') ?? ''
  );
}

function refusal(code: number, stderr: string, what: string): GitAnswer {
  const line = firstLine(stderr);
  const detail =
    code === 128
      ? `git refused to run (exit 128${line ? `: ${line}` : ''}); if it mentions dubious ownership, add the folder with git config --global --add safe.directory`
      : `git ${what} failed (exit ${code}${line ? `: ${line}` : ''})`;
  return { state: 'refused', detail };
}

/** Every answer false: nothing licensed is written, moved or embedded. */
function closed(reason: string, repo: string | null): GuardResult {
  return {
    ok: false,
    reason,
    repo,
    licensedOk: false,
    licensedReason: reason,
    trashOk: false,
    trashReason: reason,
  };
}

const OPEN: GuardResult = {
  ok: true,
  reason: null,
  repo: null,
  licensedOk: true,
  licensedReason: null,
  trashOk: true,
  trashReason: null,
};

/** Paths git tracks, or why it could not tell. */
type Tracked = { state: 'list'; paths: string[] } | Exclude<GitAnswer, { state: 'yes' | 'no' }>;

/** Keeps licensed content out of git for one campaign folder. */
export class LicensedGuard {
  private cached: { at: number; result: GuardResult } | null = null;
  private readonly vaultDir: string;
  private readonly worldId: string;

  constructor(
    /** `<vault>/Campaigns/<world>`. */
    private readonly campaignRoot: string,
    private readonly git: GitRunner = runGit,
    private readonly now: () => number = (): number => Date.now()
  ) {
    this.vaultDir = path.dirname(path.dirname(path.resolve(campaignRoot)));
    this.worldId = path.basename(campaignRoot);
  }

  /** Forget the cached result (settings changed). */
  reset(): void {
    this.cached = null;
  }

  async check(): Promise<GuardResult> {
    if (this.cached && this.now() - this.cached.at < CACHE_MS) return this.cached.result;
    const result = await this.run().catch((error): GuardResult => {
      const reason = `Could not check that licensed content stays out of git: ${errorMessage(error)}`;
      return closed(reason, null);
    });
    this.cached = { at: this.now(), result };
    return result;
  }

  private async ignored(target: string, cwd: string): Promise<GitAnswer> {
    const result = await this.git(['check-ignore', '-q', '--no-index', '--', target], cwd);
    if (result.code === 0) return { state: 'yes' };
    if (result.code === 1) return { state: 'no' };
    if (result.code === -1) return { state: 'missing' };
    return refusal(result.code, result.stderr, 'check-ignore');
  }

  private async tracked(pathspec: string, cwd: string): Promise<Tracked> {
    const result = await this.git(['ls-files', '-z', '--', pathspec], cwd);
    if (result.code === -1) return { state: 'missing' };
    if (result.code !== 0) return refusal(result.code, result.stderr, 'ls-files') as Tracked;
    return { state: 'list', paths: result.stdout.split(/[\0\n]/).filter(p => p !== '') };
  }

  private async run(): Promise<GuardResult> {
    const gitignore = path.join(this.campaignRoot, ...LICENSED_GITIGNORE.split('/'));
    const existing = await fsp.readFile(gitignore, 'utf8').catch(error => {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    });
    const next = completeGitignore(existing);
    if (next !== null) await writeFileAtomic(gitignore, next);
    // Read it back: the checks below trust what is on disk, not what we meant to write.
    const onDisk = await fsp.readFile(gitignore, 'utf8');
    if (completeGitignore(onDisk) !== null) {
      return closed(`${LICENSED_GITIGNORE} could not be written`, null);
    }
    const aiTool = path.dirname(gitignore);
    const nested = await findNestedGit(aiTool);
    if (nested !== null) {
      return closed(
        `A git repository sits inside the mirror folder (AI Tool/${nested}); licensed content stays off until it is moved out of AI Tool/`,
        null
      );
    }
    const repo = await findGitRoot(this.campaignRoot);
    const trashFolder = path.join(this.vaultDir, '.trash', 'Campaigns', this.worldId, 'AI Tool');
    const trashRepo = await findGitRoot(trashFolder);
    if (repo === null && trashRepo === null) return { ...OPEN };

    const library = await this.libraryAnswer(repo, aiTool);
    const trash = await this.trashAnswer(trashRepo, trashFolder);
    const world = repo === null ? null : await this.worldAnswer(repo);
    const licensedReason = world ?? trash.worldReason;
    return {
      ok: library.ok,
      reason: library.reason,
      repo: repo ?? trashRepo,
      licensedOk: licensedReason === null,
      licensedReason,
      trashOk: trash.reason === null,
      trashReason: trash.reason,
    };
  }

  /** The Library and Attachments folders (ok, with a note when git is missing). */
  private async libraryAnswer(
    repo: string | null,
    aiTool: string
  ): Promise<{ ok: boolean; reason: string | null }> {
    if (repo === null) return { ok: true, reason: null };
    for (const folder of ['Library', 'Attachments']) {
      const answer = await this.ignored(`${folder}/`, aiTool);
      if (answer.state === 'missing') {
        return {
          ok: true,
          reason: `git is not installed, so tracked files could not be checked; trusting ${LICENSED_GITIGNORE} to keep the Library and images out of the repository at ${repo}`,
        };
      }
      if (answer.state === 'refused') {
        return {
          ok: false,
          reason: `${answer.detail} in ${repo}; the Library and images stay off`,
        };
      }
      if (answer.state === 'no') {
        return {
          ok: false,
          reason: `The vault is inside the git repository ${repo} and git does not ignore AI Tool/${folder}/ (a rule elsewhere overrides ${LICENSED_GITIGNORE}); the Library and images stay off until it does`,
        };
      }
    }
    const tracked = await this.tracked('.', aiTool);
    if (tracked.state === 'missing') {
      return { ok: true, reason: 'git is not installed, so tracked files could not be checked' };
    }
    if (tracked.state === 'refused') {
      return { ok: false, reason: `${tracked.detail} in ${repo}; the Library and images stay off` };
    }
    if (tracked.paths.some(p => /^(Library|Attachments)[\\/]/.test(p))) {
      return {
        ok: false,
        reason: `Licensed files are already tracked in the git repository ${repo} (AI Tool/Library or AI Tool/Attachments); remove them from git (git rm -r --cached) before the Library writes again`,
      };
    }
    return { ok: true, reason: null };
  }

  /** The whole mirror folder (licensed text in world notes): null when allowed, else why not. */
  private async worldAnswer(repo: string): Promise<string | null> {
    const folder = `Campaigns/${this.worldId}/AI Tool/`;
    const root = await this.ignored('AI Tool/', this.campaignRoot);
    if (root.state === 'missing') {
      return `git is not installed, so the mirror cannot check that the repository at ${repo} ignores the mirror folder ${folder}`;
    }
    if (root.state === 'refused') return `${root.detail} in ${repo}`;
    if (root.state === 'no') {
      return `The vault is inside the git repository ${repo}, and git does not ignore the mirror folder ${folder}`;
    }
    const tracked = await this.tracked('AI Tool', this.campaignRoot);
    if (tracked.state === 'missing') {
      return 'git is not installed, so tracked files could not be checked';
    }
    if (tracked.state === 'refused') return `${tracked.detail} in ${repo}`;
    const files = tracked.paths.filter(p => toSlash(p) !== 'AI Tool/.gitignore');
    if (files.length > 0) {
      return `Files under ${folder} are tracked in the git repository ${repo}; untrack them (git rm -r --cached) so git stops picking up the mirror folder`;
    }
    return null;
  }

  /**
   * The vault trash folder of `AI Tool/`: `reason` blocks moving Library notes and images there,
   * `worldReason` blocks licensed text in world notes (trashed world notes land there too).
   */
  private async trashAnswer(
    trashRepo: string | null,
    trashFolder: string
  ): Promise<{ reason: string | null; worldReason: string | null }> {
    if (trashRepo === null) return { reason: null, worldReason: null };
    const rel = toSlash(path.relative(trashRepo, trashFolder));
    const shown = `.trash/Campaigns/${this.worldId}/AI Tool/`;
    const stays = 'Library notes and images the mirror no longer needs stay in place';
    const root = await this.ignored(`${rel}/`, trashRepo);
    if (root.state === 'missing') {
      const why = `git is not installed, so the mirror cannot check that git ignores the vault trash folder ${shown}`;
      return { reason: `${why}; ${stays}`, worldReason: why };
    }
    if (root.state === 'refused') {
      const why = `${root.detail} in ${trashRepo}`;
      return { reason: `${why}; ${stays}`, worldReason: why };
    }
    let reason: string | null = null;
    let worldReason: string | null = null;
    if (root.state === 'no') {
      worldReason = `The vault trash folder ${shown} is inside the git repository ${trashRepo} and git does not ignore it (notes the mirror trashes go there)`;
      for (const folder of ['Library', 'Attachments']) {
        const answer = await this.ignored(`${rel}/${folder}/`, trashRepo);
        if (answer.state === 'yes') continue;
        reason =
          answer.state === 'refused'
            ? `${answer.detail} in ${trashRepo}; ${stays}`
            : `git does not ignore ${shown}${folder}/ in the repository ${trashRepo}; ${stays}`;
        break;
      }
    }
    const tracked = await this.tracked(rel, trashRepo);
    if (tracked.state !== 'list') {
      const why =
        tracked.state === 'missing'
          ? 'git is not installed, so tracked files could not be checked'
          : `${tracked.detail} in ${trashRepo}`;
      return { reason: reason ?? `${why}; ${stays}`, worldReason: worldReason ?? why };
    }
    const prefix = `${rel}/`;
    const inside = tracked.paths.map(toSlash).filter(p => p.startsWith(prefix));
    if (inside.length > 0) {
      worldReason ??= `Files under ${shown} are tracked in the git repository ${trashRepo}; untrack them (git rm -r --cached)`;
      if (inside.some(p => /^(Library|Attachments)\//.test(p.slice(prefix.length)))) {
        reason ??= `Files under ${shown}Library or Attachments are tracked in the git repository ${trashRepo}; ${stays}`;
      }
    }
    return { reason, worldReason };
  }
}

function toSlash(p: string): string {
  return p.split(path.sep).join('/').replace(/\\/g, '/');
}
