/**
 * Which world's vault to use: the id of the world the connected Foundry client
 * is running, from `getWorldInfo`, cached for the lifetime of one module
 * connection (a reconnect may be a different world).
 *
 * The id is also remembered on disk (`last-world.json` in the vault root), so the few tools that
 * only touch the play log (a paper night marked with Foundry closed) can still find the vault:
 * {@link WorldIdResolver.currentOrLastKnown}. Everything else keeps using the strict
 * {@link WorldIdResolver.current}, which never guesses.
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import type { FoundryClient } from '../foundry-client.js';

import { assertWorldId, isValidWorldId } from './paths.js';

export type WorldIdSource = Pick<FoundryClient, 'query' | 'isConnected' | 'getConnectionSerial'>;

export const LAST_WORLD_FILE = 'last-world.json';

export interface WorldIdResolverOptions {
  /** The vault root: where `last-world.json` is kept. Without it nothing is remembered. */
  dataDir?: string;
}

export class WorldIdResolver {
  private cached: { serial: number; worldId: string } | null = null;
  private pending: { serial: number; promise: Promise<string> } | null = null;
  private remembered: string | null = null;

  constructor(
    private readonly foundryClient: WorldIdSource,
    private readonly options: WorldIdResolverOptions = {}
  ) {}

  /** The current world id; throws when Foundry is not connected. */
  async current(): Promise<string> {
    if (!this.foundryClient.isConnected()) {
      this.cached = null;
      throw new Error('Foundry is not connected, so the world (and its vault) is unknown');
    }
    const serial = this.foundryClient.getConnectionSerial();
    if (this.cached?.serial === serial) return this.cached.worldId;
    if (this.pending?.serial === serial) return this.pending.promise;

    const promise = this.fetch(serial);
    this.pending = { serial, promise };
    try {
      return await promise;
    } finally {
      if (this.pending?.promise === promise) this.pending = null;
    }
  }

  /**
   * The current world id, or the last one this bridge saw when Foundry is not connected. For
   * tools that only read or append the play log; a write to Foundry must use {@link current}.
   */
  async currentOrLastKnown(): Promise<string> {
    if (this.foundryClient.isConnected()) return this.current();
    const last = await this.lastKnown();
    if (last) return last;
    throw new Error(
      'Foundry is not connected, and this bridge has not seen a world yet, so the vault is unknown. Open the world once, then try again.'
    );
  }

  /** The last world id this bridge saw, or null. */
  async lastKnown(): Promise<string | null> {
    if (this.remembered) return this.remembered;
    const file = this.lastWorldPath();
    if (!file) return null;
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as { worldId?: unknown };
      if (isValidWorldId(parsed?.worldId)) {
        this.remembered = parsed.worldId;
        return this.remembered;
      }
    } catch {
      // No file yet, or an unreadable one: nothing remembered.
    }
    return null;
  }

  /** Forget the cached id (next call asks Foundry again). */
  reset(): void {
    this.cached = null;
  }

  private async fetch(serial: number): Promise<string> {
    const info = (await this.foundryClient.query('foundry-mcp-bridge.getWorldInfo')) as
      | { id?: unknown }
      | undefined;
    const worldId = assertWorldId(info?.id);
    if (this.foundryClient.getConnectionSerial() === serial) {
      this.cached = { serial, worldId };
    }
    await this.remember(worldId);
    return worldId;
  }

  private lastWorldPath(): string | null {
    return this.options.dataDir ? path.join(this.options.dataDir, LAST_WORLD_FILE) : null;
  }

  /** Best effort: a failed write only means Foundry-offline marking cannot find the world. */
  private async remember(worldId: string): Promise<void> {
    if (this.remembered === worldId) return;
    this.remembered = worldId;
    const file = this.lastWorldPath();
    if (!file) return;
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const saved = JSON.stringify({ worldId, seenAt: new Date().toISOString() });
      await fsp.writeFile(file, `${saved}\n`, 'utf8');
    } catch {
      // Not remembered on disk; the in-memory copy still serves this run.
    }
  }
}
