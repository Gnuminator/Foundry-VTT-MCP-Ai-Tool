/**
 * Which stdio wrappers (Claude Desktop connectors) are connected to this backend, and which
 * version each runs. A wrapper is a copy installed once per PC and filters the tool list with
 * its own copy of tool-sets.ts, so an old wrapper silently hides newer tools. A current wrapper
 * says `hello` with its version and build id (build-id.ts); the dashboard says `hello` with
 * `client: 'dashboard'`. Any other connection that calls a tool without a `requestedBy` and never
 * said hello is an old wrapper (the dashboard sets `requestedBy` on its writes only, so it must
 * say hello).
 */
import { CLIENT_NOTICE_INTERVAL_MS, TOOL_VERSION, clientToolNotice } from '@gnuminator/shared';

import { BUILD_ID } from './build-id.js';
import { TOOL_RESULT_MAX_CHARS } from './tool-router.js';

export {
  isOlderVersion,
  isOtherBuild,
  type WrapperEntry,
  type WrapperStatus,
} from './wrapper-version.js';
import {
  isOlderVersion,
  isOtherBuild,
  type WrapperEntry,
  type WrapperStatus,
} from './wrapper-version.js';

/**
 * True when a wrapper should be updated: too old to say its version, an older version, or the
 * same version from another build.
 */
export function isWrapperBehind(w: WrapperEntry, current: string, build: string): boolean {
  return (
    w.version === null || isOlderVersion(w.version, current) || isOtherBuild(w, current, build)
  );
}

export class WrapperRegistry {
  private readonly byConnection = new Map<number, WrapperEntry>();

  /** Connections that said they are not a Claude Desktop wrapper (the dashboard). */
  private readonly notWrappers = new Set<number>();

  /** When each connection last got the outdated line (ms). */
  private readonly lastNotice = new Map<number, number>();

  constructor(
    private readonly current: string = TOOL_VERSION,
    private readonly build: string = BUILD_ID
  ) {}

  /** A wrapper said hello on this connection (the dashboard says hello too, as `client`). */
  hello(connection: number, params: unknown): void {
    const p = (params ?? {}) as {
      version?: unknown;
      build?: unknown;
      sets?: unknown;
      client?: unknown;
    };
    if (p.client === 'dashboard') {
      this.byConnection.delete(connection);
      this.notWrappers.add(connection);
      return;
    }
    this.byConnection.set(connection, {
      version: typeof p.version === 'string' && p.version ? p.version.slice(0, 40) : null,
      build: typeof p.build === 'string' && p.build ? p.build.slice(0, 40) : null,
      sets: typeof p.sets === 'string' && p.sets ? p.sets.slice(0, 80) : 'unknown',
    });
  }

  /** A tool call without a requester arrived: a wrapper; an old one when it never said hello. */
  toolCallWithoutRequester(connection: number): void {
    if (!this.byConnection.has(connection) && !this.notWrappers.has(connection)) {
      this.byConnection.set(connection, { version: null, build: null, sets: 'unknown' });
    }
  }

  close(connection: number): void {
    this.byConnection.delete(connection);
    this.notWrappers.delete(connection);
    this.lastNotice.delete(connection);
  }

  /**
   * The one outdated line for a tool answer on this connection, or null. Only a connected wrapper
   * whose version is older than the backend's (or unknown) gets it; the same version from another
   * build does not. At most once per connection per CLIENT_NOTICE_INTERVAL_MS.
   */
  noticeFor(connection: number, now: number, answerChars = 0): string | null {
    const w = this.byConnection.get(connection);
    if (!w) return null;
    if (w.version !== null && !isOlderVersion(w.version, this.current)) return null;
    const last = this.lastNotice.get(connection);
    if (last !== undefined && now - last < CLIENT_NOTICE_INTERVAL_MS) return null;
    const line = clientToolNotice('connectors', w.version, this.current);
    // The wrapper cuts an answer at TOOL_RESULT_MAX_CHARS (capToolResult): a line that does not fit
    // would be dropped or would turn a complete answer into a "cut" one. Keep the slot for later.
    if (answerChars + line.length > TOOL_RESULT_MAX_CHARS) return null;
    this.lastNotice.set(connection, now);
    return line;
  }

  status(): WrapperStatus {
    const wrappers = [...this.byConnection.values()];
    const behind = wrappers.some(w => isWrapperBehind(w, this.current, this.build));
    return { current: this.current, build: this.build, wrappers, behind };
  }
}
