import type { PlayerHandout, PlayerVisibility } from '@gnuminator/shared';

import type { Logger } from '../logger.js';

import { sanitizeHandoutHtml } from './sanitize.js';

/** The bridge calls this source needs (the MCP control client satisfies it). */
export interface PlayerSourceClient {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  readonly isConnected?: boolean;
}

interface RawHandouts {
  handouts?: unknown;
  revealedUuids?: unknown;
}

/** One handout row as the bridge sent it, checked (raw GM HTML, only while sanitizing). */
interface RawRow {
  id: string;
  uuid: string | null;
  title: string;
  html: string;
  revealedAt: string | null;
  players: string[] | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * The player view's context from the bridge (M2): what players can see right
 * now (`get-player-visibility`) and the revealed pages (`get-player-handouts`),
 * polled while the control channel is up. Handout HTML is sanitized here, on
 * arrival, so unsanitized GM HTML is never stored next to player data. A failed
 * poll keeps the last good values (an older bridge without these tools simply
 * leaves them empty).
 */
export class PlayerViewSource {
  private visibilityValue: PlayerVisibility | null = null;
  private handoutsValue: PlayerHandout[] = [];
  /** Per player (O7 vaults): handouts that player may see, links cleaned for that player. */
  private perPlayerValue = new Map<string, PlayerHandout[]>();
  /** Handouts for a player named on no `players` list: only the ones for every player. */
  private everyPlayerValue: PlayerHandout[] = [];
  private handoutsReadyValue = false;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    private readonly client: PlayerSourceClient,
    private readonly logger: Logger,
    private readonly onChange: () => void
  ) {}

  get visibility(): PlayerVisibility | null {
    return this.visibilityValue;
  }

  /**
   * Every revealed handout for the player page (`/player`), links cleaned against every revealed
   * page. The page gets all of them and shows each player the ones meant for them (D-065).
   */
  get handouts(): PlayerHandout[] {
    return this.handoutsValue;
  }

  /**
   * The handouts one player may see (no `players` list, or a list that names them), each cleaned
   * against only the pages revealed to that player: a link to a page revealed to someone else
   * loses its label. For the O7 player vaults, which are files on that player's own disk.
   */
  handoutsFor(userId: string): PlayerHandout[] {
    return this.perPlayerValue.get(userId) ?? this.everyPlayerValue;
  }

  /** True once `get-player-handouts` has answered at least once. */
  get handoutsReady(): boolean {
    return this.handoutsReadyValue;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Poll both tools once; `onChange` fires when either result changed. */
  async refresh(): Promise<void> {
    if (this.inFlight || this.client.isConnected === false) return;
    this.inFlight = true;
    let changed = false;
    try {
      const visibility = await this.client
        .callTool<PlayerVisibility>('get-player-visibility')
        .catch((error: unknown) => this.failed('get-player-visibility', error));
      if (visibility !== undefined && this.isVisibility(visibility)) {
        changed ||= JSON.stringify(visibility) !== JSON.stringify(this.visibilityValue);
        this.visibilityValue = visibility;
      }
      const raw = await this.client
        .callTool<RawHandouts>('get-player-handouts')
        .catch((error: unknown) => this.failed('get-player-handouts', error));
      if (raw !== undefined) {
        const { all, perPlayer, everyPlayer } = this.sanitize(raw);
        changed ||= JSON.stringify(all) !== JSON.stringify(this.handoutsValue);
        this.handoutsValue = all;
        this.perPlayerValue = perPlayer;
        this.everyPlayerValue = everyPlayer;
        this.handoutsReadyValue = true;
      }
    } finally {
      this.inFlight = false;
    }
    if (changed) this.onChange();
  }

  private failed(tool: string, error: unknown): undefined {
    this.logger.debug(`${tool} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  private isVisibility(v: unknown): v is PlayerVisibility {
    const r = asRecord(v);
    return !!r && Array.isArray(r.pcActorIds) && Array.isArray(r.tokens);
  }

  /**
   * Raw handouts -> player handouts with sanitized HTML (unknown shapes are dropped): `all` for
   * the player page, and per player for the vaults. The raw GM HTML is not kept.
   */
  private sanitize(raw: RawHandouts): {
    all: PlayerHandout[];
    perPlayer: Map<string, PlayerHandout[]>;
    everyPlayer: PlayerHandout[];
  } {
    const revealed = Array.isArray(raw.revealedUuids)
      ? raw.revealedUuids.filter((u): u is string => typeof u === 'string')
      : [];
    const list: unknown[] = Array.isArray(raw.handouts) ? raw.handouts : [];
    const rows: RawRow[] = [];
    for (const item of list) {
      const h = asRecord(item);
      const id = str(h?.id);
      const title = str(h?.title);
      if (!h || !id || !title) continue;
      const players = Array.isArray(h.players)
        ? h.players.filter((p): p is string => typeof p === 'string')
        : [];
      rows.push({
        id,
        uuid: str(h.uuid),
        title,
        html: typeof h.html === 'string' ? h.html : '',
        revealedAt: str(h.revealedAt),
        players: players.length > 0 ? players : null,
      });
    }

    // A page is limited to some players only when every row for it names players; a page with
    // no row (not observable yet) keeps the old rule: revealed to all.
    const limitedTo = new Map<string, Set<string>>();
    const open = new Set<string>();
    for (const row of rows) {
      if (!row.uuid) continue;
      if (!row.players) {
        open.add(row.uuid);
        continue;
      }
      const set = limitedTo.get(row.uuid) ?? new Set<string>();
      for (const p of row.players) set.add(p);
      limitedTo.set(row.uuid, set);
    }
    for (const uuid of open) limitedTo.delete(uuid);
    const revealedFor = (userId: string | null): string[] =>
      revealed.filter(uuid => {
        const only = limitedTo.get(uuid);
        return !only || (userId !== null && only.has(userId));
      });

    const build = (row: RawRow, uuids: string[]): PlayerHandout => ({
      id: row.id,
      title: row.title,
      html: sanitizeHandoutHtml(row.html, uuids),
      revealedAt: row.revealedAt,
      // I-039: for chosen players only; the player page shows it to them (picked name, D-065).
      ...(row.players ? { players: row.players } : {}),
    });

    const all = rows.map(row => build(row, revealed));
    const forAudience = (userId: string | null): PlayerHandout[] => {
      const uuids = revealedFor(userId);
      return rows
        .filter(row => !row.players || (userId !== null && row.players.includes(userId)))
        .map(row => build(row, uuids));
    };
    const perPlayer = new Map<string, PlayerHandout[]>();
    for (const row of rows) {
      for (const userId of row.players ?? []) {
        if (!perPlayer.has(userId)) perPlayer.set(userId, forAudience(userId));
      }
    }
    return { all, perPlayer, everyPlayer: forAudience(null) };
  }
}
