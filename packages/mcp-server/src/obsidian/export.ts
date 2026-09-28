/**
 * Export the bridge vault into the GM's Obsidian vault (docs/OBSIDIAN-PLAN.md, O1).
 *
 * One way only: bridge vault -> Markdown. Ownership rules:
 *
 * - `Campaigns/<worldId>/AI Tool/` belongs to the exporter: its notes are
 *   rebuilt on every export (a note whose text did not change is left alone,
 *   so a note open in Obsidian is not touched for nothing).
 * - `Campaigns/<worldId>/Home.md` and `Prep/` are the GM's: created once if
 *   missing, never rewritten.
 * - Nothing outside `Campaigns/<worldId>/` is written. Writes are atomic
 *   (temp file + rename).
 *
 * Read-only on the bridge vault; the notes are GM-only (the Obsidian vault is
 * the GM's private note app, never a player-facing place).
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import type { AuditEntry, AuditLog } from '../vault/audit.js';
import type { VaultStore } from '../vault/store.js';

import {
  renderCampaignHome,
  renderChangesNote,
  renderSessionNote,
  renderTarokkaNote,
  type ChangeEntry,
  type SessionEvent,
  type TarokkaLinks,
  type TarokkaReadingData,
} from './render.js';

const SESSION_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface ExportResult {
  worldId: string;
  root: string;
  written: string[];
  unchanged: string[];
  created: string[];
}

interface TarokkaFile {
  current?: TarokkaReadingData;
  archive?: Record<string, TarokkaReadingData>;
  revealJournal?: { uuid?: string };
}

interface TarokkaConfig {
  cardNames?: Record<string, string>;
  links?: Partial<Record<string, Record<string, TarokkaLinks>>>;
}

function isCompleteReading(value: unknown): value is TarokkaReadingData {
  const r = value as Partial<TarokkaReadingData> | undefined;
  return Boolean(r && typeof r.readingId === 'string' && r.positions);
}

/** Where a world's notes go: `<vaultDir>/Campaigns/<worldId>`. */
export function campaignDir(vaultDir: string, worldId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(worldId)) throw new Error(`Bad world id "${worldId}"`);
  return path.join(path.resolve(vaultDir), 'Campaigns', worldId);
}

class NoteWriter {
  readonly written: string[] = [];
  readonly unchanged: string[] = [];
  readonly created: string[] = [];

  constructor(private readonly root: string) {}

  private resolve(relPath: string): string {
    const full = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to write outside ${this.root}: ${relPath}`);
    }
    return full;
  }

  /** Write a note the exporter owns (rewritten only when the text changed). */
  async owned(relPath: string, text: string): Promise<void> {
    const full = this.resolve(relPath);
    const current = await fsp.readFile(full, 'utf8').catch(() => null);
    if (current === text) {
      this.unchanged.push(relPath);
      return;
    }
    await this.atomicWrite(full, text);
    this.written.push(relPath);
  }

  /** Create a GM-owned file or folder once; never touch it again. */
  async createOnce(relPath: string, text: string | null): Promise<void> {
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
  }

  private async atomicWrite(full: string, text: string): Promise<void> {
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, full);
  }
}

const PREP_README = [
  '---',
  'type: readme',
  '---',
  '# Prep',
  '',
  'Your campaign notes: session plans, NPCs, locations, threads. The AI Tool never writes here.',
  '',
].join('\n');

/** Render one world's bridge vault into `<vaultDir>/Campaigns/<worldId>/`. */
export async function exportWorldToObsidian(options: {
  store: VaultStore;
  audit: Pick<AuditLog, 'list'>;
  worldId: string;
  vaultDir: string;
}): Promise<ExportResult> {
  const { store, audit, worldId } = options;
  const root = campaignDir(options.vaultDir, worldId);
  const writer = new NoteWriter(root);

  await writer.createOnce('Home.md', renderCampaignHome(worldId));
  await writer.createOnce('Prep', null);
  await writer.createOnce('Prep/README.md', PREP_README);

  // Session logs, one note per day file.
  for (const file of await store.list(worldId, 'sessions')) {
    const match = SESSION_FILE.exec(file);
    if (!match) continue;
    const events = (await store.readLines(worldId, 'sessions', file)) as SessionEvent[];
    await writer.owned(
      `AI Tool/Sessions/${match[1]}.md`,
      renderSessionNote(worldId, match[1], events)
    );
  }

  // Change log, one note per month.
  const entries: AuditEntry[] = await audit.list(worldId, 500);
  const byMonth = new Map<string, ChangeEntry[]>();
  for (const e of entries) {
    const month = e.appliedAt.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push({
      changeId: e.changeId,
      feature: e.feature,
      summary: e.summary,
      risk: e.risk,
      target: e.target,
      mode: e.mode,
      appliedAt: e.appliedAt,
      diff: e.diff,
      ...(e.undoOf ? { undoOf: e.undoOf } : {}),
      ...(e.undoneBy ? { undoneBy: e.undoneBy } : {}),
      ...(e.undoneAt ? { undoneAt: e.undoneAt } : {}),
    });
    byMonth.set(month, list);
  }
  for (const [month, list] of byMonth) {
    await writer.owned(`AI Tool/Changes/${month}.md`, renderChangesNote(worldId, month, list));
  }

  // Tarokka (only when the world has used it).
  const tarokka = (await store.read<TarokkaFile>(worldId, 'gm', 'tarokka.json'))?.data;
  if (tarokka) {
    const config = (await store.read<TarokkaConfig>(worldId, 'gm', 'tarokka-config.json'))?.data;
    const reading = isCompleteReading(tarokka.current) ? tarokka.current : null;
    await writer.owned(
      'AI Tool/Tarokka/Current reading.md',
      renderTarokkaNote(worldId, reading, {
        ...(config?.links ? { links: config.links } : {}),
        ...(config?.cardNames ? { cardNames: config.cardNames } : {}),
        archived: Object.keys(tarokka.archive ?? {}),
        revealJournalUuid: tarokka.revealJournal?.uuid ?? null,
      })
    );
  }

  return {
    worldId,
    root,
    written: writer.written,
    unchanged: writer.unchanged,
    created: writer.created,
  };
}
