import {
  PREP_BEAT_KINDS,
  PREP_SCAN_QUERY,
  type PlayRecord,
  type PreflightChecksResult,
  type PrepBeat,
  type PrepCampaignPart,
  type PrepDigest,
  type PrepLastSession,
  type PrepPreflightSummary,
  type PrepQueuedHandout,
  type PrepQuest,
  type PrepScan,
} from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { HandoutsService } from '../handouts/service.js';
import type { GuardedWriteService } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';
import { eventTimeMs, groupWithPlayRecords, type SessionEvent } from '../obsidian/grouping.js';
import { buildSceneNameIndex, buildStats, sceneName } from '../stats/build.js';
import { loadPlayRecords, loadSessionEvents } from '../stats/load.js';
import type { SessionStats, StatsModel } from '../stats/types.js';
import type { TarokkaService } from '../tarokka/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';
import type { PreflightTools } from './preflight.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface PrepDigestToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: Pick<VaultStore, 'list' | 'readLines'>;
  handouts: Pick<HandoutsService, 'listRevealed' | 'listQueue'>;
  preflight: Pick<PreflightTools, 'checks'>;
  guardedWrites: Pick<GuardedWriteService, 'listRecentChanges'>;
  tarokka: Pick<TarokkaService, 'getReading'>;
  logger: Logger;
  now?: () => number;
}

/** Beats kept per action: `summary` the most recent 25, `last-session` up to 200. */
const MAX_BEATS = { summary: 25, 'last-session': 200 } as const;
/** Reveals made just after the last logged event still belong to the session. */
const REVEAL_GRACE_MS = 60_000;
const MAX_PREFLIGHT_ITEMS = 8;
const LATEST_CHANGES = 5;
const BEAT_KINDS: ReadonlySet<string> = new Set(PREP_BEAT_KINDS);
const CLOSED_PART_STATUSES: ReadonlySet<string> = new Set(['completed', 'skipped']);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

function isoOf(event: SessionEvent): string {
  return new Date(eventTimeMs(event)).toISOString();
}

/** What the vault parts need from the last session. */
interface LastSessionResult {
  lastSession: Omit<PrepLastSession, 'handoutsRevealed'> | null;
  sceneNames: Map<string, string>;
}

/**
 * `get-prep-digest` (I-045): the facts a GM wants before preparing the next
 * session, in one read. The vault parts (last session, handouts, recent
 * changes, pre-flight, Tarokka) work without Foundry; quests, campaign parts,
 * the "Next session" journal and bosses come from the module's `getPrepScan`.
 * Every part fails soft: a broken source becomes a warning. Read-only, facts
 * only, never Tarokka cards.
 */
export class PrepDigestTools {
  private readonly options: PrepDigestToolsOptions;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(options: PrepDigestToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'PrepDigestTools' });
    this.now = options.now ?? ((): number => Date.now());
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-prep-digest',
        description:
          'GM ONLY. The facts for preparing the next session, in one call, no prose. Gathers: the last session (scenes in order, fights, who went down to 0 HP (PCs and others; not who died), story beats, handouts revealed; read from the bridge vault, so it works after a Foundry reload), open quests and unfinished campaign parts, the GM\'s "Next session" journal, the handout reveal queue, bosses placed on scenes, the pre-flight summary and the latest guarded changes. Only whether a Tarokka reading exists, never the cards. If Foundry is not connected the vault parts still come back and "warnings" says what is missing. action "summary" (default): the most recent 25 beats; "last-session": up to 200 beats. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['summary', 'last-session'],
              description:
                '"summary" (default) for the digest with the most recent 25 beats, "last-session" for up to 200 beats.',
            },
          },
        },
      },
    ];
  }

  async handleGetPrepDigest(args: unknown): Promise<PrepDigest> {
    const { action } = z
      .object({ action: z.enum(['summary', 'last-session']).default('summary') })
      .parse(args ?? {});
    const warnings: string[] = [];
    const worldId = await this.options.worldIds.current();

    const [last, scan, queue, preflight, recent, tarokka] = await Promise.all([
      this.lastSession(worldId, action, warnings),
      this.foundryScan(warnings),
      this.queue(warnings),
      this.preflightSummary(warnings),
      this.recentChanges(warnings),
      this.hasTarokkaReading(warnings),
    ]);

    // Scene names for the queue: the play log's scene records, then the bosses' scenes.
    const sceneNames = new Map(last.sceneNames);
    for (const boss of scan?.bosses ?? []) {
      if (boss.sceneId && boss.sceneName) sceneNames.set(boss.sceneId, boss.sceneName);
    }

    let lastSession: PrepLastSession | null = null;
    if (last.lastSession) {
      lastSession = {
        ...last.lastSession,
        handoutsRevealed: await this.handoutsRevealed(last.lastSession, warnings),
      };
    }

    return {
      schema: 1,
      action,
      worldId,
      computedAt: this.now(),
      lastSession,
      openQuests: scan ? openQuests(scan) : null,
      openCampaignParts: scan ? openCampaignParts(scan) : null,
      ...(scan ? { nextSession: scan.nextSession ?? null } : {}),
      handoutQueue: queue.map(
        (q): PrepQueuedHandout => ({
          title: q.title,
          uuid: q.uuid,
          sceneId: q.sceneId,
          sceneName: q.sceneId ? (sceneNames.get(q.sceneId) ?? null) : null,
          ...(q.players ? { players: q.players } : {}),
        })
      ),
      bosses: scan ? scan.bosses : null,
      preflight,
      recentChanges: recent,
      tarokka: { hasReading: tarokka },
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Vault parts
  // -------------------------------------------------------------------------

  private async lastSession(
    worldId: string,
    action: 'summary' | 'last-session',
    warnings: string[]
  ): Promise<LastSessionResult> {
    try {
      const [logEvents, playRecords] = await Promise.all([
        loadSessionEvents(this.options.store, worldId),
        loadPlayRecords(this.options.store, worldId),
      ]);
      const model = buildStats({ worldId, logEvents, playRecords });
      // buildStats numbers one session per group of this same grouping, in order.
      const groups = groupWithPlayRecords(logEvents, playRecords);
      const stats = model.sessions[model.sessions.length - 1];
      const group = groups[groups.length - 1];
      const sceneNames = buildSceneNameIndex(playRecords);
      if (!stats || !group) return { lastSession: null, sceneNames };
      return {
        lastSession: describeSession(stats, group, sceneNames, action, pcNamesOf(model)),
        sceneNames,
      };
    } catch (error) {
      this.logger.warn('Prep digest: last session failed', { error: message(error) });
      warnings.push(`The last session could not be read from the vault: ${message(error)}`);
      return { lastSession: null, sceneNames: new Map() };
    }
  }

  private async handoutsRevealed(
    session: Omit<PrepLastSession, 'handoutsRevealed'>,
    warnings: string[]
  ): Promise<PrepLastSession['handoutsRevealed']> {
    try {
      const from = Date.parse(session.startedAt);
      const to = Date.parse(session.endedAt) + REVEAL_GRACE_MS;
      const pages = await this.options.handouts.listRevealed();
      return pages
        .filter(p => {
          const at = Date.parse(p.revealedAt);
          return Number.isFinite(at) && at >= from && at <= to;
        })
        .map(p => ({
          title: p.title ?? p.uuid,
          uuid: p.uuid,
          seenBy: [...new Set(p.seenBy.map(s => s.name))],
        }));
    } catch (error) {
      this.logger.warn('Prep digest: revealed handouts failed', { error: message(error) });
      warnings.push(`Handouts revealed last session could not be read: ${message(error)}`);
      return [];
    }
  }

  private async queue(warnings: string[]): Promise<
    Array<{
      title: string;
      uuid: string;
      sceneId: string | null;
      players?: string[];
    }>
  > {
    try {
      const queue = await this.options.handouts.listQueue();
      return queue.map(q => ({
        title: q.title ?? q.uuid,
        uuid: q.uuid,
        sceneId: q.sceneId,
        ...(q.players ? { players: q.players } : {}),
      }));
    } catch (error) {
      this.logger.warn('Prep digest: handout queue failed', { error: message(error) });
      warnings.push(`The handout reveal queue could not be read: ${message(error)}`);
      return [];
    }
  }

  private async preflightSummary(warnings: string[]): Promise<PrepPreflightSummary | null> {
    try {
      const result: PreflightChecksResult = await this.options.preflight.checks();
      const flagged = result.checks.filter(c => c.status === 'fail' || c.status === 'warn');
      const failing = flagged.filter(c => c.status === 'fail');
      const warning = flagged.filter(c => c.status === 'warn');
      return {
        fail: failing.length,
        warn: warning.length,
        items: [...failing, ...warning].slice(0, MAX_PREFLIGHT_ITEMS).map(c => ({
          severity: c.status === 'fail' ? 'fail' : 'warn',
          title: c.label,
        })),
      };
    } catch (error) {
      this.logger.warn('Prep digest: pre-flight failed', { error: message(error) });
      warnings.push(`The pre-flight check could not run: ${message(error)}`);
      return null;
    }
  }

  private async recentChanges(warnings: string[]): Promise<PrepDigest['recentChanges']> {
    try {
      const changes = await this.options.guardedWrites.listRecentChanges(50);
      // Newest first; an undo is an entry of its own, not a change to prepare around.
      const applied = changes.filter(c => c.mode === 'apply');
      return {
        count: applied.length,
        latest: applied
          .slice(0, LATEST_CHANGES)
          .map(c => ({ title: c.summary, appliedAt: c.appliedAt })),
      };
    } catch (error) {
      this.logger.warn('Prep digest: recent changes failed', { error: message(error) });
      warnings.push(`Recent changes could not be read: ${message(error)}`);
      return { count: 0, latest: [] };
    }
  }

  private async hasTarokkaReading(warnings: string[]): Promise<boolean> {
    try {
      return (await this.options.tarokka.getReading()).available === true;
    } catch (error) {
      this.logger.warn('Prep digest: Tarokka check failed', { error: message(error) });
      warnings.push(`Whether a Tarokka reading exists could not be checked: ${message(error)}`);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Foundry part
  // -------------------------------------------------------------------------

  private async foundryScan(warnings: string[]): Promise<PrepScan | null> {
    try {
      const raw = unwrap<Partial<PrepScan> | null>(
        await this.options.foundryClient.query(`foundry-mcp-bridge.${PREP_SCAN_QUERY}`, {}),
        'The prep scan was refused'
      );
      if (!raw || typeof raw !== 'object') throw new Error('Foundry sent no scan');
      return {
        schema: 1,
        computedAt: typeof raw.computedAt === 'number' ? raw.computedAt : this.now(),
        quests: Array.isArray(raw.quests) ? raw.quests : [],
        campaigns: Array.isArray(raw.campaigns) ? raw.campaigns : [],
        nextSession: raw.nextSession ?? null,
        bosses: Array.isArray(raw.bosses) ? raw.bosses : [],
      };
    } catch (error) {
      this.logger.warn('Prep digest: Foundry scan failed', { error: message(error) });
      warnings.push(
        `Foundry did not answer the prep scan (${message(error)}): quests, campaign parts, the Next session journal and bosses are missing.`
      );
      return null;
    }
  }
}

/** Player character names the play log knows (records mark a dnd5e `character` as a PC). */
function pcNamesOf(model: StatsModel): Set<string> {
  return new Set(model.pcs.map(pc => pc.name));
}

function openQuests(scan: PrepScan): PrepQuest[] {
  return scan.quests.filter(q => q.open === true);
}

function openCampaignParts(
  scan: PrepScan
): Array<{ journalId: string; name: string; parts: PrepCampaignPart[] }> {
  return scan.campaigns.flatMap(campaign => {
    const parts = campaign.parts.filter(p => !CLOSED_PART_STATUSES.has(p.status));
    return parts.length > 0 ? [{ journalId: campaign.journalId, name: campaign.name, parts }] : [];
  });
}

function describeSession(
  stats: SessionStats,
  group: { events: SessionEvent[]; playRecords: PlayRecord[] },
  sceneNames: Map<string, string>,
  action: 'summary' | 'last-session',
  pcNames: ReadonlySet<string>
): Omit<PrepLastSession, 'handoutsRevealed'> {
  // Scenes in the order they were first visited: every record names the scene the GM viewed.
  const scenes: string[] = [];
  const seenScenes = new Set<string>();
  const timeline = group.playRecords.filter(r => r.sceneId).sort((a, b) => a.t - b.t);
  for (const record of timeline) {
    const name = sceneName(record.sceneId, sceneNames) ?? 'Unknown scene';
    if (!seenScenes.has(name)) {
      seenScenes.add(name);
      scenes.push(name);
    }
  }

  const ordered = [...group.events].sort((a, b) => eventTimeMs(a) - eventTimeMs(b));
  const beats: PrepBeat[] = ordered
    .filter(e => typeof e.eventType === 'string' && BEAT_KINDS.has(e.eventType))
    .map(e => ({
      at: isoOf(e),
      kind: e.eventType ?? '',
      text: e.description ?? '',
      actorName: e.actorName ?? null,
    }));
  const max = MAX_BEATS[action];
  // A `death` event means "dropped to 0 HP", for monsters too; whether someone died is the GM's call.
  const down = [
    ...new Set(
      ordered
        .filter(e => e.eventType === 'death' && typeof e.actorName === 'string' && e.actorName)
        .map(e => e.actorName as string)
    ),
  ];

  return {
    number: stats.number,
    label: stats.label,
    date: stats.date,
    startedAt: stats.startedAt,
    endedAt: stats.endedAt,
    durationMin: stats.durationMin,
    scenes,
    combats: stats.combats.length,
    combatRounds: stats.combatRounds,
    pcDowns: stats.pcDowns,
    npcKills: stats.npcKills,
    spellsCast: stats.spellsCast,
    wentDown: {
      pcs: down.filter(name => pcNames.has(name)),
      others: down.filter(name => !pcNames.has(name)),
    },
    beats: beats.length > max ? beats.slice(beats.length - max) : beats,
    beatsTruncated: beats.length > max,
  };
}
