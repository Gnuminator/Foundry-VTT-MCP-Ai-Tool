/**
 * Session prep digest contract (idea I-045; design in the vault note
 * `Design/I-045 Session prep digest.md`, agreed 2026-09-30).
 *
 * Flow:
 * - The module's `getPrepScan` query runs on the GM client and reads what only
 *   Foundry has: quest journals and their Status line, campaign dashboard parts
 *   (the `world.campaignStatus` flag), the GM's "Next session" journal and the
 *   boss creatures placed on scenes. Read only.
 * - The bridge tool `get-prep-digest` (prep set) adds what the bridge has: the
 *   last play session from the vault logs (it survives Foundry reloads, unlike
 *   `get-session-log`), the handout reveal queue and reveals, the pre-flight
 *   checklist, recent guarded changes and whether a Tarokka reading exists.
 *   It returns facts only, never prose: Claude writes prose when asked
 *   (`prep-next-session` prompt), and the dashboard's Prep drawer shows the
 *   same facts without AI (D-077).
 * - When Foundry is not connected, the digest still returns the vault parts
 *   and says what is missing in `warnings`.
 *
 * GM only: the digest may name hidden things (boss tokens, GM journals). It
 * never carries Tarokka card names or ids, only `tarokka.hasReading`.
 */

import type { PreflightSeverity } from './preflight.js';
import type { CampaignPartStatus } from './types.js';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const PREP_SCAN_QUERY = 'getPrepScan';

/** The GM's prep notes journal, matched by name, case-insensitive, trimmed. */
export const NEXT_SESSION_JOURNAL_NAME = 'Next session';

/** Quest Status values (lower case) that count as closed; anything else is open. */
export const CLOSED_QUEST_STATUSES = ['completed', 'complete', 'done', 'failed', 'abandoned'];

/** A quest journal made by `create-quest-journal` (it has a "Status:" line). */
export interface PrepQuest {
  journalId: string;
  name: string;
  /** The Status line's text as written, e.g. "Active". */
  status: string;
  /** False when `status` is one of CLOSED_QUEST_STATUSES. */
  open: boolean;
}

/** One part of a campaign dashboard journal (`create-campaign-dashboard`). */
export interface PrepCampaignPart {
  partId: string;
  /** The part's heading text, or the part id when no heading was found. */
  title: string;
  /** From the `world.campaignStatus` flag, else the toggle's class, else not_started. */
  status: CampaignPartStatus;
}

export interface PrepCampaign {
  journalId: string;
  name: string;
  campaignId: string;
  parts: PrepCampaignPart[];
}

/** One page of the "Next session" journal as plain text. */
export interface PrepNotePage {
  pageId: string;
  name: string;
  /** Text with tags stripped, whitespace collapsed, at most 2,000 characters. */
  text: string;
  truncated: boolean;
}

export interface PrepNextSession {
  journalId: string;
  name: string;
  pages: PrepNotePage[];
  /** True when a player can observe the journal or a page (it should be GM only). */
  playerVisible: boolean;
}

export interface PrepBossCounter {
  max: number;
  spent: number;
  remaining: number;
}

/** A creature with legendary actions, legendary resistances or a lair, placed on a scene. */
export interface PrepBoss {
  sceneId: string;
  sceneName: string;
  tokenId: string;
  tokenName: string;
  actorName: string;
  hidden: boolean;
  legendary: PrepBossCounter | null;
  resistances: PrepBossCounter | null;
  lair: { inside: boolean; initiative: number | null } | null;
}

/** What `getPrepScan` returns. */
export interface PrepScan {
  schema: 1;
  computedAt: number;
  quests: PrepQuest[];
  campaigns: PrepCampaign[];
  /** Null when no journal has the name NEXT_SESSION_JOURNAL_NAME. */
  nextSession: PrepNextSession | null;
  bosses: PrepBoss[];
}

/** One story beat of a session, from the vault's session events. */
export interface PrepBeat {
  /** ISO time. */
  at: string;
  /** The session event type, e.g. "scene-change", "combat-start", "death", "journal-updated". */
  kind: string;
  /** The event's own one-line description (GM wording). */
  text: string;
  actorName: string | null;
}

/** Event types that become beats (in this order of interest; others are left out). */
export const PREP_BEAT_KINDS = [
  'scene-change',
  'combat-start',
  'combat-end',
  'death',
  'stabilize',
  'journal-created',
  'journal-updated',
  'gm-change',
] as const;

export interface PrepLastSession {
  /** Same numbering and label as the Obsidian session notes and `get-play-stats`. */
  number: number;
  label: string;
  date: string;
  startedAt: string;
  endedAt: string;
  durationMin: number;
  /** Scene names in the order they were first visited. */
  scenes: string[];
  combats: number;
  combatRounds: number;
  pcDowns: number;
  npcKills: number;
  spellsCast: number;
  /**
   * Who dropped to 0 HP (the `death` session event), in order, without repeats; split into player
   * characters and everyone else. Not who died: the tool never knows that, and a PC here may have
   * got back up.
   */
  wentDown: { pcs: string[]; others: string[] };
  /** `summary`: at most 25 beats, the most recent kept; `last-session`: at most 200. */
  beats: PrepBeat[];
  beatsTruncated: boolean;
  /** Handouts revealed during the session (by `revealedAt`), with who has seen them. */
  handoutsRevealed: Array<{ title: string; uuid: string; seenBy: string[] }>;
}

export interface PrepQueuedHandout {
  title: string;
  uuid: string;
  sceneId: string | null;
  /** Scene name when known; null for "any scene". */
  sceneName: string | null;
  /** Only these users (Foundry user ids); absent: every player. */
  players?: string[];
}

export interface PrepPreflightSummary {
  fail: number;
  warn: number;
  /** Titles of the failing and warning checks, failing first, at most 8. */
  items: Array<{ severity: PreflightSeverity; title: string }>;
}

/** What `get-prep-digest` returns. */
export interface PrepDigest {
  schema: 1;
  action: 'summary' | 'last-session';
  worldId: string;
  computedAt: number;
  /** Null when the vault has no play session yet. */
  lastSession: PrepLastSession | null;
  /** Open quests only; null when Foundry was not reachable. */
  openQuests: PrepQuest[] | null;
  /** Campaign parts that are not completed or skipped, per campaign; null without Foundry. */
  openCampaignParts: Array<{ journalId: string; name: string; parts: PrepCampaignPart[] }> | null;
  /** Undefined without Foundry; null when the journal does not exist. */
  nextSession?: PrepNextSession | null;
  handoutQueue: PrepQueuedHandout[];
  /** Null without Foundry. */
  bosses: PrepBoss[] | null;
  /** Null when the pre-flight check could not run. */
  preflight: PrepPreflightSummary | null;
  recentChanges: { count: number; latest: Array<{ title: string; appliedAt: string }> };
  tarokka: { hasReading: boolean };
  /** Plain sentences for the GM, e.g. "Foundry is not connected: quests, campaign parts, the Next session journal and bosses are missing." */
  warnings: string[];
}
