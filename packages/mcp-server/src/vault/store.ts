/**
 * Bridge vault store (plan step 0.3): JSON files on the backend host, outside
 * Foundry world data, so nothing here ever reaches a player's client.
 *
 * - Every JSON file is an envelope `{schema, updatedAt, data}` (`schema` lets a
 *   feature migrate its own data later).
 * - Writes are atomic: a temp file in the same directory, flushed, then renamed
 *   over the target. On Windows a rename can fail briefly with EPERM/EBUSY/EACCES
 *   while a virus scanner or indexer holds the file, so it is retried.
 * - Writes to one file are serialized by a per-file queue; `update` is a
 *   read-modify-write inside that queue, so concurrent updates never lose data.
 * - A file that exists but does not parse is reported, never overwritten.
 */
import { randomBytes } from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';

import {
  VAULT_AREAS,
  assertWorldId,
  isValidFileName,
  isValidWorldId,
  vaultFilePath,
  worldDir,
  type VaultArea,
} from './paths.js';

export interface VaultEnvelope<T = unknown> {
  schema: number;
  updatedAt: string;
  data: T;
}

export interface VaultStoreOptions {
  dataDir: string;
  /** Rename used for the atomic swap (tests inject failures). */
  rename?: (from: string, to: string) => Promise<void>;
  /** Waits between rename retries; the number of entries is the retry count. */
  renameRetryDelaysMs?: number[];
  now?: () => Date;
}

const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_RETRY_DELAYS = [10, 25, 50, 100, 200, 400];

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isEnvelope(value: unknown): value is VaultEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.schema === 'number' && typeof v.updatedAt === 'string' && 'data' in v;
}

export class VaultStore {
  readonly dataDir: string;
  private readonly renameFile: (from: string, to: string) => Promise<void>;
  private readonly retryDelays: number[];
  private readonly now: () => Date;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(options: VaultStoreOptions) {
    this.dataDir = path.resolve(options.dataDir);
    this.renameFile = options.rename ?? ((from, to): Promise<void> => fsp.rename(from, to));
    this.retryDelays = options.renameRetryDelaysMs ?? DEFAULT_RETRY_DELAYS;
    this.now = options.now ?? ((): Date => new Date());
  }

  /** Absolute path of a vault file (validated). */
  filePath(worldId: string, area: VaultArea, file: string): string {
    return vaultFilePath(this.dataDir, worldId, area, file);
  }

  /** Read a JSON file, or null when it does not exist. */
  async read<T = unknown>(
    worldId: string,
    area: VaultArea,
    file: string
  ): Promise<VaultEnvelope<T> | null> {
    return this.readPath<T>(this.filePath(worldId, area, file));
  }

  /** Replace a JSON file atomically. */
  async write<T>(
    worldId: string,
    area: VaultArea,
    file: string,
    data: T,
    schema = 1
  ): Promise<VaultEnvelope<T>> {
    const full = this.filePath(worldId, area, file);
    return this.enqueue(full, async () => {
      const envelope: VaultEnvelope<T> = { schema, updatedAt: this.now().toISOString(), data };
      await this.writeAtomic(full, `${JSON.stringify(envelope, null, 2)}\n`);
      return envelope;
    });
  }

  /**
   * Read-modify-write inside the file's queue. `fn` gets the current envelope
   * (null when the file is new) and returns the new data. Its result is
   * written with `schema` and returned.
   */
  async update<T>(
    worldId: string,
    area: VaultArea,
    file: string,
    schema: number,
    fn: (current: VaultEnvelope<T> | null) => T | Promise<T>
  ): Promise<VaultEnvelope<T>> {
    const full = this.filePath(worldId, area, file);
    return this.enqueue(full, async () => {
      const current = await this.readPath<T>(full);
      const data = await fn(current);
      const envelope: VaultEnvelope<T> = { schema, updatedAt: this.now().toISOString(), data };
      await this.writeAtomic(full, `${JSON.stringify(envelope, null, 2)}\n`);
      return envelope;
    });
  }

  /** Read a file's raw text, or null when it does not exist (export). */
  async readRaw(worldId: string, area: VaultArea, file: string): Promise<string | null> {
    try {
      return await fsp.readFile(this.filePath(worldId, area, file), 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  }

  /** Replace a file with raw text, atomically (import). */
  async writeRaw(worldId: string, area: VaultArea, file: string, text: string): Promise<void> {
    const full = this.filePath(worldId, area, file);
    return this.enqueue(full, () => this.writeAtomic(full, text));
  }

  /** Append JSON lines (one value per line) to a `.jsonl` file. */
  async appendLines(
    worldId: string,
    area: VaultArea,
    file: string,
    values: unknown[]
  ): Promise<void> {
    if (!file.endsWith('.jsonl')) throw new Error(`Not a .jsonl file: ${file}`);
    const full = this.filePath(worldId, area, file);
    if (values.length === 0) return;
    const text = `${values.map(v => JSON.stringify(v)).join('\n')}\n`;
    return this.enqueue(full, async () => {
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.appendFile(full, text, 'utf8');
    });
  }

  /** Read a `.jsonl` file as parsed values (missing file: empty). Bad lines are skipped. */
  async readLines(worldId: string, area: VaultArea, file: string): Promise<unknown[]> {
    const full = this.filePath(worldId, area, file);
    let text: string;
    try {
      text = await fsp.readFile(full, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    const values: unknown[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        values.push(JSON.parse(line));
      } catch {
        // A torn last line after a crash; the rest of the log is still usable.
      }
    }
    return values;
  }

  /** Delete a file (no error when it is already gone). */
  async remove(worldId: string, area: VaultArea, file: string): Promise<void> {
    const full = this.filePath(worldId, area, file);
    return this.enqueue(full, async () => {
      try {
        await fsp.unlink(full);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    });
  }

  /** Vault file names in one area (temp files and foreign names are skipped). */
  async list(worldId: string, area: VaultArea): Promise<string[]> {
    const dir = path.join(worldDir(this.dataDir, worldId), area);
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      return entries
        .filter(e => e.isFile() && isValidFileName(e.name))
        .map(e => e.name)
        .sort();
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }

  /** World ids that have a vault directory. */
  async listWorlds(): Promise<string[]> {
    try {
      const entries = await fsp.readdir(this.dataDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && isValidWorldId(e.name))
        .map(e => e.name)
        .sort();
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }

  /** Every area and file of one world (for export). */
  async listAll(worldId: string): Promise<Array<{ area: VaultArea; file: string }>> {
    assertWorldId(worldId);
    const out: Array<{ area: VaultArea; file: string }> = [];
    for (const area of VAULT_AREAS) {
      for (const file of await this.list(worldId, area)) out.push({ area, file });
    }
    return out;
  }

  /** Wait until every queued write has finished (tests, shutdown). */
  async flush(): Promise<void> {
    while (this.queues.size > 0) {
      await Promise.allSettled([...this.queues.values()]);
    }
  }

  // -------------------------------------------------------------------------

  private async readPath<T>(full: string): Promise<VaultEnvelope<T> | null> {
    let text: string;
    try {
      text = await fsp.readFile(full, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Vault file is not valid JSON (left untouched): ${full}`);
    }
    if (!isEnvelope(parsed)) {
      throw new Error(`Vault file has no {schema, updatedAt, data} envelope: ${full}`);
    }
    return parsed as VaultEnvelope<T>;
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  private async writeAtomic(full: string, text: string): Promise<void> {
    const dir = path.dirname(full);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.${path.basename(full)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    );
    const handle = await fsp.open(tmp, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await this.renameWithRetry(tmp, full);
    } catch (error) {
      await fsp.unlink(tmp).catch(() => undefined);
      throw error;
    }
  }

  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.renameFile(from, to);
        return;
      } catch (error) {
        const code = errorCode(error);
        if (!code || !RETRYABLE_RENAME.has(code) || attempt >= this.retryDelays.length) {
          throw error;
        }
        await sleep(this.retryDelays[attempt] ?? 0);
      }
    }
  }
}
