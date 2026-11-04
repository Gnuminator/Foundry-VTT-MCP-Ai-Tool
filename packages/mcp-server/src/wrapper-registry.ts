/**
 * Which stdio wrappers (Claude Desktop connectors) are connected to this backend, and which
 * version each runs. A wrapper is a copy installed once per PC and filters the tool list with
 * its own copy of tool-sets.ts, so an old wrapper silently hides newer tools. A current wrapper
 * says `hello` with its version; the dashboard says `hello` with `client: 'dashboard'`. Any
 * other connection that calls a tool without a `requestedBy` and never said hello is an old
 * wrapper (the dashboard sets `requestedBy` on its writes only, so it must say hello).
 */
import { TOOL_VERSION } from '@gnuminator/shared';

export interface WrapperEntry {
  /** The wrapper's tool version, or null for a wrapper too old to send one. */
  version: string | null;
  /** The tool sets it lists ("all" when it lists every set). */
  sets: string;
}

export interface WrapperStatus {
  current: string;
  wrappers: WrapperEntry[];
  /** True when any connected wrapper is older than the backend or sends no version. */
  behind: boolean;
}

function parts(version: string): number[] {
  return version.split('.').map(p => Number.parseInt(p, 10) || 0);
}

/** True when `version` is older than `current` (plain numeric x.y.z compare). */
export function isOlderVersion(version: string, current: string): boolean {
  const a = parts(version);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

export class WrapperRegistry {
  private readonly byConnection = new Map<number, WrapperEntry>();

  /** Connections that said they are not a Claude Desktop wrapper (the dashboard). */
  private readonly notWrappers = new Set<number>();

  constructor(private readonly current: string = TOOL_VERSION) {}

  /** A wrapper said hello on this connection (the dashboard says hello too, as `client`). */
  hello(connection: number, params: unknown): void {
    const p = (params ?? {}) as { version?: unknown; sets?: unknown; client?: unknown };
    if (p.client === 'dashboard') {
      this.byConnection.delete(connection);
      this.notWrappers.add(connection);
      return;
    }
    this.byConnection.set(connection, {
      version: typeof p.version === 'string' && p.version ? p.version.slice(0, 40) : null,
      sets: typeof p.sets === 'string' && p.sets ? p.sets.slice(0, 80) : 'unknown',
    });
  }

  /** A tool call without a requester arrived: a wrapper; an old one when it never said hello. */
  toolCallWithoutRequester(connection: number): void {
    if (!this.byConnection.has(connection) && !this.notWrappers.has(connection)) {
      this.byConnection.set(connection, { version: null, sets: 'unknown' });
    }
  }

  close(connection: number): void {
    this.byConnection.delete(connection);
    this.notWrappers.delete(connection);
  }

  status(): WrapperStatus {
    const wrappers = [...this.byConnection.values()];
    const behind = wrappers.some(
      w => w.version === null || isOlderVersion(w.version, this.current)
    );
    return { current: this.current, wrappers, behind };
  }
}
