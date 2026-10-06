/**
 * O7 player vault (vault `Design/O7 player vault design 2026-10-06.md`): one Obsidian vault per
 * player, written by the dashboard one way, holding only what that player may see. Contract
 * between the renderer (`render.ts`, pure) and the service that gathers inputs and writes folders
 * (`service.ts`, `writer.ts`).
 */
import type { CharacterSheet, PlayerEvent, PlayerHandout } from '@gnuminator/shared';

import type { ThemeId } from '../theme.js';

/** A player of the world (a Foundry user who is not a GM). */
export interface VaultPlayer {
  userId: string;
  name: string;
}

/** One play session of the public log: projected events only (`projectEvent`), oldest first. */
export interface VaultSession {
  /** Stable label, `YYYY-MM-DD` of the first event (a second session that day: `YYYY-MM-DD (2)`). */
  label: string;
  events: PlayerEvent[];
}

export interface PlayerVaultInput {
  worldTitle: string;
  player: VaultPlayer;
  /**
   * Revealed handouts from the player projection (`PlayerState.handouts`, HTML already through
   * `sanitizeHandoutHtml`). The renderer itself drops any handout whose `players` list exists and
   * does not hold `player.userId` (defence in depth: the service filters too).
   */
  handouts: PlayerHandout[];
  /** The player's own characters (`character_sheet` for this user: owned `character` actors). */
  sheets: CharacterSheet[];
  sessions: VaultSession[];
  /** The world's dashboard theme, and its Obsidian snippet CSS when the build has it (else null). */
  theme: { id: ThemeId; css: string | null };
}

/** Vault-relative path (forward slashes) to file content. Includes `.obsidian/*` files. */
export type PlayerVaultFiles = Map<string, string>;
