/**
 * The shared note writer for the Obsidian exporter and the Foundry mirror
 * (docs/design/OBSIDIAN-PLAN.md O2, docs/design/OBSIDIAN-O4-DESIGN.md 3.5).
 *
 * Moved out of `export.ts` without a behavior change: one writer per
 * campaign folder, enforcing the ownership rules and the path fence, and
 * tracking what happened for `ExportResult`. O4 adds three things, all
 * backwards compatible: a `same` comparator on {@link NoteWriter.owned} (the
 * mirror ignores `fvtt_modified`), {@link NoteWriter.assertRealFence} (a
 * junction or symlink must not lead a write out of the fence), and
 * {@link NoteWriter.trash} (one note to the vault `.trash/`). I-100 adds
 * {@link NoteWriter.move} (one owned note to a new folder, by rename).
 *
 * Lifetime: one writer per export run or mirror cycle. The result arrays
 * (`written`, `unchanged`, ...) are handed out by reference (`ExportResult`),
 * so there is deliberately no `reset()`: create a new writer for the next run
 * and share the `cache` between them.
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import { writeFileAtomic } from './atomic-write.js';
import type { OwnershipResult } from './ownership.js';

/** The status line of an edited note that stays in a folder it no longer belongs in (I-100). */
export const KEPT_AT_OLD_PATH = 'kept at its old path because it was edited';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

const WORLD_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Where a world's notes go: `<vaultDir>/Campaigns/<worldId>`. */
export function campaignDir(vaultDir: string, worldId: string): string {
  if (!WORLD_ID.test(worldId)) throw new Error(`Bad world id "${worldId}"`);
  return path.join(path.resolve(vaultDir), 'Campaigns', worldId);
}

/** The text last written per note path (`ExportCache` satisfies this). */
export interface WrittenCache {
  written: Map<string, string>;
}

export interface OwnedOptions {
  /**
   * Called only when the existing file passes the ownership check and differs
   * from `nextText`: true means the file already holds the note in another
   * form and is left alone (the mirror ignores `fvtt_modified`).
   */
  same?: (existingText: string, nextText: string) => boolean;
}

/** `child` is `parent` itself or lies below it (case rules of the platform). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * `realpath` of `target`, or, when it does not exist yet, the real path of its
 * deepest existing ancestor plus the missing tail (which cannot hold a link).
 * A dangling link is refused: writing through it would create its target.
 */
async function realpathOfDeepest(target: string): Promise<string> {
  const tail: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return tail.length > 0 ? path.join(real, ...tail) : real;
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const isLink = await fsp.lstat(current).then(
        () => true,
        () => false
      );
      if (isLink) throw new Error(`Refusing a link that leads nowhere: ${current}`);
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Writes generated notes under one campaign folder, enforcing the ownership
 * rules and the path fence, and tracking what happened for `ExportResult`. */
export class NoteWriter {
  readonly written: string[] = [];
  readonly unchanged: string[] = [];
  readonly created: string[] = [];
  readonly skipped: Array<{ path: string; reason: string }> = [];
  readonly trashed: string[] = [];
  /** Notes moved to a new path ({@link NoteWriter.move}). */
  readonly moved: Array<{ from: string; to: string }> = [];
  readonly errors: Array<{ path: string; error: string }> = [];
  private readonly produced = new Set<string>();

  /** How many notes this export produced so far. */
  get producedCount(): number {
    return this.produced.size;
  }

  constructor(
    private readonly root: string,
    private readonly vaultDir: string,
    private readonly worldId: string,
    private readonly cache: WrittenCache = { written: new Map() }
  ) {}

  private resolve(relPath: string): string {
    const full = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to write outside ${this.root}: ${relPath}`);
    }
    return full;
  }

  /**
   * Refuse to write into `relFolder` when a link leads out of the fence: the
   * real path of `<root>/<relFolder>` (or of its deepest existing ancestor)
   * must lie inside the real path of the campaign folder, which must lie
   * inside the real path of the vault. Call it before the first write of a
   * run; throws (never records) so the caller can abort the whole run.
   */
  async assertRealFence(relFolder: string): Promise<void> {
    const target = this.resolve(relFolder);
    const realVault = await realpathOfDeepest(this.vaultDir);
    const realRoot = await realpathOfDeepest(this.root);
    if (!isInside(realVault, realRoot)) {
      throw new Error(`Refusing to write: ${this.root} leads outside the vault (${realRoot})`);
    }
    const realTarget = await realpathOfDeepest(target);
    if (!isInside(realRoot, realTarget)) {
      throw new Error(
        `Refusing to write: ${relFolder} leads outside ${this.root} (${realTarget}); is there a link or junction?`
      );
    }
  }

  /** Write a note the exporter owns: skipped when an existing file fails the
   * ownership check, otherwise written (or left alone when unchanged, or when
   * `options.same` says the file already holds the note in another form). */
  async owned(
    relPath: string,
    text: string,
    check: (existingText: string) => OwnershipResult,
    options: OwnedOptions = {}
  ): Promise<void> {
    try {
      const full = this.resolve(relPath);
      this.produced.add(relPath);
      if (this.cache.written.get(relPath) === text) {
        this.unchanged.push(relPath);
        return;
      }
      const current = await fsp.readFile(full, 'utf8').catch(error => {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      });
      let same = current === text;
      if (current !== null) {
        const result = check(current);
        if (!result.owned) {
          this.skipped.push({ path: relPath, reason: result.reason });
          return;
        }
        same ||= result.same === true;
        if (!same && options.same?.(current, text) === true) same = true;
      }
      if (same) {
        this.unchanged.push(relPath);
        this.cache.written.set(relPath, text);
        return;
      }
      await writeFileAtomic(full, text);
      this.written.push(relPath);
      this.cache.written.set(relPath, text);
    } catch (error) {
      this.errors.push({ path: relPath, error: errorMessage(error) });
    }
  }

  /** Create a GM-owned file or folder once; never touch it again. */
  async createOnce(relPath: string, text: string | null): Promise<void> {
    try {
      const full = this.resolve(relPath);
      const exists = await fsp.stat(full).then(
        () => true,
        () => false
      );
      if (exists) return;
      if (text === null) {
        await fsp.mkdir(full, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(full), { recursive: true });
        await fsp.writeFile(full, text, { encoding: 'utf8', flag: 'wx' });
      }
      this.created.push(relPath);
    } catch (error) {
      this.errors.push({ path: relPath, error: errorMessage(error) });
    }
  }

  /** A managed folder's notes not produced this run: moved to `.trash/` when
   * still ours (or legacy), left in place (and listed as skipped) otherwise. */
  async pruneManaged(
    folder: string,
    check: (existingText: string) => OwnershipResult
  ): Promise<void> {
    const dirFull = this.resolve(folder);
    let names: string[];
    try {
      names = await fsp.readdir(dirFull);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      this.errors.push({ path: folder, error: errorMessage(error) });
      return;
    }
    for (const name of names) {
      const relPath = `${folder}/${name}`;
      if (this.produced.has(relPath)) continue;
      try {
        const full = this.resolve(relPath);
        const stat = await fsp.stat(full);
        if (!stat.isFile()) continue;
        const text = await fsp.readFile(full, 'utf8');
        const result = check(text);
        if (!result.owned) {
          this.skipped.push({ path: relPath, reason: result.reason });
          continue;
        }
        await this.moveToTrash(relPath);
      } catch (error) {
        this.errors.push({ path: relPath, error: errorMessage(error) });
      }
    }
  }

  /**
   * Move one note to the vault `.trash/` when it is still ours (the same rules
   * as {@link pruneManaged}); an edited or foreign note stays and is listed in
   * `skipped`. Returns what happened: `'trashed'`, `'kept'` (edited, foreign,
   * a link or not a file, or a failure, which is also recorded in `errors`)
   * or `'missing'` (nothing there, nothing recorded).
   */
  async trash(
    relPath: string,
    check: (existingText: string) => OwnershipResult
  ): Promise<'trashed' | 'kept' | 'missing'> {
    try {
      const full = this.resolve(relPath);
      const stat = await fsp.lstat(full).catch(error => {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      });
      if (!stat) return 'missing';
      if (!stat.isFile()) {
        this.skipped.push({ path: relPath, reason: 'not written by the AI Tool' });
        return 'kept';
      }
      const result = check(await fsp.readFile(full, 'utf8'));
      if (!result.owned) {
        this.skipped.push({ path: relPath, reason: result.reason });
        return 'kept';
      }
      await this.moveToTrash(relPath);
      return 'trashed';
    } catch (error) {
      this.errors.push({ path: relPath, error: errorMessage(error) });
      return 'kept';
    }
  }

  /**
   * Move one note to a new path (I-100: its folder changed) with a single rename, so there is
   * never a second copy and nothing is lost halfway. Only a note that passes `check` moves; an
   * edited or foreign note stays and is listed in `skipped` ("kept at its old path"). The target
   * must not exist yet. Returns `'moved'`, `'kept'` (edited, foreign, not a file, target taken,
   * or a failure, which is also recorded in `errors`) or `'missing'` (nothing there). The source
   * folder is removed when the move left it empty (best effort).
   */
  async move(
    from: string,
    to: string,
    check: (existingText: string) => OwnershipResult
  ): Promise<'moved' | 'kept' | 'missing'> {
    try {
      const source = this.resolve(from);
      const target = this.resolve(to);
      const stat = await fsp.lstat(source).catch(error => {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      });
      if (!stat) return 'missing';
      if (!stat.isFile()) {
        this.skipped.push({ path: from, reason: 'not written by the AI Tool' });
        return 'kept';
      }
      const result = check(await fsp.readFile(source, 'utf8'));
      if (!result.owned) {
        this.skipped.push({
          path: from,
          reason:
            result.reason === 'edited in Obsidian'
              ? KEPT_AT_OLD_PATH
              : `${result.reason}; kept at its old path`,
        });
        return 'kept';
      }
      const occupied = await fsp.lstat(target).then(
        () => true,
        () => false
      );
      if (occupied) throw new Error(`Not moved to ${to}: a file is already there`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rename(source, target);
      this.cache.written.delete(from);
      this.moved.push({ from, to });
      await fsp.rmdir(path.dirname(source)).catch(() => undefined);
      return 'moved';
    } catch (error) {
      this.errors.push({ path: from, error: errorMessage(error) });
      return 'kept';
    }
  }

  private async moveToTrash(relPath: string): Promise<void> {
    const source = this.resolve(relPath);
    const targetBase = path.join(this.vaultDir, '.trash', 'Campaigns', this.worldId, relPath);
    await fsp.mkdir(path.dirname(targetBase), { recursive: true });
    const ext = path.extname(targetBase);
    const stem = targetBase.slice(0, targetBase.length - ext.length);
    let target = targetBase;
    for (
      let n = 1;
      await fsp.stat(target).then(
        () => true,
        () => false
      );
      n++
    ) {
      target = `${stem} ${n}${ext}`;
    }
    await fsp.rename(source, target);
    this.trashed.push(relPath);
  }
}
