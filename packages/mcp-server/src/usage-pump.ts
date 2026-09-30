/**
 * Backend usage pump (I-084): polls the Foundry module's usage buffer
 * (`foundry-mcp-bridge.getUsageRecords`, the `PlayRecordsResponse` shape) and
 * feeds `UsageLog`. The cursor works like the play-log pump's: `{ clientId,
 * lastSeq }` per world in `sessions/usage-pump-state.json`; a different
 * `clientId` means the module reloaded, so the pump re-asks from 0 (the log
 * drops the keys it already holds). Restart-safe.
 *
 * An old module without the handler answers "No handler found for query";
 * that is treated as "nothing to read" (one debug line, no warnings).
 *
 * Shares `FOUNDRY_AI_EVENT_POLL_MS` with the other pumps; `FOUNDRY_AI_USAGE_LOG=off`
 * disables it (see `usage-log.ts`).
 */
import { sanitizeUsageEvent, type PlayRecordsResponse, type UsageEvent } from '@gnuminator/shared';

import { DEFAULT_EVENT_POLL_MS } from './event-pump.js';
import type { FoundryClient } from './foundry-client.js';
import type { Logger } from './logger.js';
import type { UsageLog } from './usage-log.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

export const USAGE_PUMP_STATE_FILE = 'usage-pump-state.json';
const FETCH_LIMIT = 5000;
const QUERY = 'foundry-mcp-bridge.getUsageRecords';

interface UsagePumpState {
  clientId: string | null;
  lastSeq: number;
}

export interface UsagePumpOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  usageLog: Pick<UsageLog, 'append' | 'flushPending' | 'enabled'>;
  logger: Logger;
  intervalMs?: number;
}

/** The module does not know the query (an older build). */
function isMissingHandler(message: string): boolean {
  return /no handler found|unknown (query|method)/i.test(message);
}

export class UsagePump {
  private readonly foundry: UsagePumpOptions['foundryClient'];
  private readonly worldIds: UsagePumpOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly usageLog: UsagePumpOptions['usageLog'];
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<number> | null = null;
  private state: { worldId: string; clientId: string | null; lastSeq: number } | null = null;
  private lastError: string | null = null;
  private loggedMissing = false;

  constructor(options: UsagePumpOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.usageLog = options.usageLog;
    this.logger = options.logger.child({ component: 'UsagePump' });
    this.intervalMs = options.intervalMs ?? DEFAULT_EVENT_POLL_MS;
  }

  start(): void {
    if (this.timer) return;
    if (!this.usageLog.enabled) return;
    this.timer = setInterval(() => void this.pollOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetch new events and hand them to the log. Resolves to the number handed over; never rejects. */
  pollOnce(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    const run = this.poll()
      .then(count => {
        if (this.lastError) this.logger.info('Usage pump recovered');
        this.lastError = null;
        return count;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (isMissingHandler(message)) {
          if (!this.loggedMissing) {
            this.loggedMissing = true;
            this.logger.debug('Foundry module has no usage records yet (older module build)');
          }
          return 0;
        }
        if (message !== this.lastError) {
          this.logger.warn('Usage pump poll failed', { error: message });
        }
        this.lastError = message;
        return 0;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }

  private async poll(): Promise<number> {
    if (!this.usageLog.enabled || !this.foundry.isConnected()) return 0;
    const worldId = await this.worldIds.current();
    await this.usageLog.flushPending(worldId);
    const state = await this.loadState(worldId);

    let response = await this.fetchRecords(state.lastSeq);
    if (state.clientId !== null && response.clientId !== state.clientId) {
      response = await this.fetchRecords(0);
    } else if (state.clientId !== null && response.oldestSeq > state.lastSeq + 1) {
      this.logger.warn('Usage events lost: the module buffer wrapped before the pump read them', {
        worldId,
        expectedFrom: state.lastSeq + 1,
        oldestSeq: response.oldestSeq,
      });
    }

    const events: UsageEvent[] = [];
    const raw = Array.isArray(response.records) ? (response.records as unknown[]) : [];
    for (const candidate of raw) {
      const clean = sanitizeUsageEvent(candidate);
      if (clean) events.push(clean);
    }
    if (events.length > 0) await this.usageLog.append(worldId, events);

    const changed = state.clientId !== response.clientId || state.lastSeq !== response.latestSeq;
    state.clientId = response.clientId;
    state.lastSeq = response.latestSeq;
    if (changed) await this.saveState(worldId);
    return events.length;
  }

  private async fetchRecords(sinceSeq: number): Promise<PlayRecordsResponse> {
    const response = (await this.foundry.query(QUERY, {
      sinceSeq,
      limit: FETCH_LIMIT,
    })) as PlayRecordsResponse;
    if (response?.success === false) {
      throw new Error(response.error ?? 'getUsageRecords refused');
    }
    return response;
  }

  private async loadState(
    worldId: string
  ): Promise<{ worldId: string; clientId: string | null; lastSeq: number }> {
    if (this.state?.worldId === worldId) return this.state;
    const saved = await this.store.read<UsagePumpState>(worldId, 'sessions', USAGE_PUMP_STATE_FILE);
    const clientId = typeof saved?.data.clientId === 'string' ? saved.data.clientId : null;
    const lastSeq = typeof saved?.data.lastSeq === 'number' ? saved.data.lastSeq : 0;
    this.state = { worldId, clientId, lastSeq };
    return this.state;
  }

  private async saveState(worldId: string): Promise<void> {
    if (!this.state || this.state.worldId !== worldId) return;
    const data: UsagePumpState = { clientId: this.state.clientId, lastSeq: this.state.lastSeq };
    await this.store.write(worldId, 'sessions', USAGE_PUMP_STATE_FILE, data);
  }
}
