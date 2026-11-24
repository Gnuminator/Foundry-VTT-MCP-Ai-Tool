/**
 * Per-tool AI permissions (item tool-permissions, I-077): the GM sets each tool, or a whole tool
 * set, to allow, ask or deny. Only calls that come from Claude through a connector are checked;
 * the dashboard's own buttons and the player set never are. There is no spend meter (D-066).
 *
 * - allow: runs (the default for everything, so nothing changes until the GM sets one).
 * - deny: refused with a plain message.
 * - ask: refused with "waiting for the GM" and listed as pending on the dashboard. The GM's Allow
 *   once grants one call of that tool for GRANT_MS; Claude retries and the retry runs.
 *
 * A tool's own setting beats its set's; no setting means allow. The settings live in
 * `<dataDir>/tool-permissions.json`. Pure of SDKs; the clock is injectable.
 */
import { mkdirSync, readFileSync } from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';

import { toolSetOf, ALL_TOOL_SET_NAMES } from './tool-sets.js';

export const TOOL_PERMISSION_POLICIES = ['allow', 'ask', 'deny'] as const;
export type ToolPolicy = (typeof TOOL_PERMISSION_POLICIES)[number];

export const TOOL_PERMISSIONS_FILE = 'tool-permissions.json';

/** How long an "Allow once" stays good for the retry. */
export const GRANT_MS = 5 * 60_000;
/** A pending ask nobody answered is dropped after this. */
const PENDING_MS = 60 * 60_000;
const MAX_PENDING = 50;

export function isToolPolicy(value: unknown): value is ToolPolicy {
  return (TOOL_PERMISSION_POLICIES as readonly unknown[]).includes(value);
}

export interface PendingAsk {
  tool: string;
  set: string | null;
  /** Epoch ms of the first refused call. */
  at: number;
}

export interface PermissionCheck {
  ok: boolean;
  /** For a refusal: what Claude is told. */
  message?: string;
}

export interface PermissionsSnapshot {
  /** Per set: its own policy and each tool's own policy (absent: follows the set / allow). */
  sets: Array<{ set: string; policy: ToolPolicy | null }>;
  tools: Array<{
    tool: string;
    set: string | null;
    own: ToolPolicy | null;
    effective: ToolPolicy;
  }>;
  pending: PendingAsk[];
}

interface Stored {
  tools: Record<string, ToolPolicy>;
  sets: Record<string, ToolPolicy>;
}

export class ToolPermissions {
  private data: Stored = { tools: {}, sets: {} };
  private readonly pending = new Map<string, PendingAsk>();
  private readonly grants = new Map<string, number>();
  private readonly file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly now: () => number = Date.now
  ) {
    this.file = path.join(dataDir, TOOL_PERMISSIONS_FILE);
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>;
      for (const [k, v] of Object.entries(raw.tools ?? {}))
        if (isToolPolicy(v) && k !== '__proto__') this.data.tools[k] = v;
      for (const [k, v] of Object.entries(raw.sets ?? {}))
        if (isToolPolicy(v) && (ALL_TOOL_SET_NAMES as readonly string[]).includes(k))
          this.data.sets[k] = v;
    } catch {
      // No file or a damaged one: everything allowed, as before this feature.
    }
  }

  /** The policy that applies to a tool now. */
  policyFor(tool: string): ToolPolicy {
    if (Object.hasOwn(this.data.tools, tool)) return this.data.tools[tool];
    const set = toolSetOf(tool);
    if (set && Object.hasOwn(this.data.sets, set)) return this.data.sets[set];
    return 'allow';
  }

  /** Check one call from Claude. An "ask" with a live grant spends the grant and runs. */
  check(tool: string): PermissionCheck {
    const policy = this.policyFor(tool);
    if (policy === 'allow') return { ok: true };
    if (policy === 'deny') {
      return {
        ok: false,
        message: `The GM has turned "${tool}" off for the AI. Tell the GM; do not try another tool to do the same thing.`,
      };
    }
    const now = this.now();
    const until = this.grants.get(tool);
    if (until !== undefined && until > now) {
      this.grants.delete(tool);
      this.pending.delete(tool);
      return { ok: true };
    }
    this.prune(now);
    if (!this.pending.has(tool)) {
      this.pending.set(tool, { tool, set: toolSetOf(tool) ?? null, at: now });
      if (this.pending.size > MAX_PENDING) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) this.pending.delete(oldest);
      }
    }
    return {
      ok: false,
      message: `"${tool}" needs the GM's OK. It is waiting on the co-GM dashboard (Tool permissions). Tell the GM, and try again once they have pressed Allow once.`,
    };
  }

  /** Allow one call of a tool that is on "ask". */
  approve(tool: string): void {
    this.grants.set(tool, this.now() + GRANT_MS);
    this.pending.delete(tool);
  }

  dismiss(tool: string): void {
    this.pending.delete(tool);
    this.grants.delete(tool);
  }

  /** Set (or clear with null) the policy of one tool or one set; saved before it resolves. */
  async set(kind: 'tool' | 'set', name: string, policy: ToolPolicy | null): Promise<void> {
    if (kind === 'tool') {
      if (!this.knownTool(name)) throw new Error(`Unknown tool "${name}"`);
    } else if (!(ALL_TOOL_SET_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Unknown tool set "${name}"`);
    }
    const bucket = kind === 'tool' ? this.data.tools : this.data.sets;
    if (policy === null) delete bucket[name];
    else bucket[name] = policy;
    this.prune(this.now());
    await this.save();
  }

  snapshot(toolNames: readonly string[]): PermissionsSnapshot {
    this.prune(this.now());
    return {
      sets: ALL_TOOL_SET_NAMES.map(set => ({ set, policy: this.data.sets[set] ?? null })),
      tools: toolNames.map(tool => ({
        tool,
        set: toolSetOf(tool) ?? null,
        own: this.data.tools[tool] ?? null,
        effective: this.policyFor(tool),
      })),
      pending: [...this.pending.values()].sort((a, b) => a.at - b.at),
    };
  }

  private knownTool(name: string): boolean {
    return toolSetOf(name) !== undefined;
  }

  private prune(now: number): void {
    // A card or grant only means something while the tool is on Ask (a set-wide change can end that).
    for (const [tool, p] of this.pending)
      if (now - p.at > PENDING_MS || this.policyFor(tool) !== 'ask') this.pending.delete(tool);
    for (const [tool, until] of this.grants)
      if (until <= now || this.policyFor(tool) !== 'ask') this.grants.delete(tool);
  }

  private save(): Promise<void> {
    const body = `${JSON.stringify(this.data, null, 2)}\n`;
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await fsp.writeFile(tmp, body, 'utf8');
        await fsp.rename(tmp, this.file);
      });
    return this.writing;
  }
}

/** The control method `tool_permissions`: read, or change one setting, approve or dismiss. */
export async function handleToolPermissions(
  perms: ToolPermissions,
  toolNames: readonly string[],
  params: unknown
): Promise<PermissionsSnapshot> {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const action = p.action;
  const name = typeof p.name === 'string' ? p.name : '';
  if (action === 'set') {
    const kind = p.kind === 'set' ? 'set' : 'tool';
    const policy = p.policy === null || p.policy === 'default' ? null : p.policy;
    if (policy !== null && !isToolPolicy(policy))
      throw new Error('policy must be allow, ask, deny or default');
    await perms.set(kind, name, policy);
  } else if (action === 'approve') perms.approve(name);
  else if (action === 'dismiss') perms.dismiss(name);
  else if (action !== undefined && action !== 'get') throw new Error('Unknown action');
  return perms.snapshot(toolNames);
}
