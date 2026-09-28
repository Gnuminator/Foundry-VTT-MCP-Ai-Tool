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

  get handouts(): PlayerHandout[] {
    return this.handoutsValue;
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
        const handouts = this.sanitize(raw);
        changed ||= JSON.stringify(handouts) !== JSON.stringify(this.handoutsValue);
        this.handoutsValue = handouts;
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

  /** Raw handouts -> player handouts with sanitized HTML (unknown shapes are dropped). */
  private sanitize(raw: RawHandouts): PlayerHandout[] {
    const revealed = Array.isArray(raw.revealedUuids)
      ? raw.revealedUuids.filter((u): u is string => typeof u === 'string')
      : [];
    const list: unknown[] = Array.isArray(raw.handouts) ? raw.handouts : [];
    const out: PlayerHandout[] = [];
    for (const item of list) {
      const h = asRecord(item);
      const id = str(h?.id);
      const title = str(h?.title);
      if (!h || !id || !title) continue;
      out.push({
        id,
        title,
        html: sanitizeHandoutHtml(typeof h.html === 'string' ? h.html : '', revealed),
        revealedAt: str(h.revealedAt),
      });
    }
    return out;
  }
}
