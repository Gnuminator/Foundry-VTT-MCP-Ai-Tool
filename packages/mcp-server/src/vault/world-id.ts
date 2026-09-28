/**
 * Which world's vault to use: the id of the world the connected Foundry client
 * is running, from `getWorldInfo`, cached for the lifetime of one module
 * connection (a reconnect may be a different world).
 */
import type { FoundryClient } from '../foundry-client.js';

import { assertWorldId } from './paths.js';

export type WorldIdSource = Pick<FoundryClient, 'query' | 'isConnected' | 'getConnectionSerial'>;

export class WorldIdResolver {
  private cached: { serial: number; worldId: string } | null = null;
  private pending: { serial: number; promise: Promise<string> } | null = null;

  constructor(private readonly foundryClient: WorldIdSource) {}

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
    return worldId;
  }
}
