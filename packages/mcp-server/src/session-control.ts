/**
 * Control methods for the dashboard's switch views (never MCP tools; the stdio wrapper only
 * forwards `list_tools` and `call_tool`, so Claude cannot reach them):
 *
 * - `session_switches` (D3, PB-17): read, turn on (`ready`) or turn back off (`end`) tonight's
 *   switches in the module (`sessionSwitches` query).
 * - `feature_switches` (I-064): read every feature switch for the dashboard's feature cards
 *   (the module's `listGuardedFeatures` query). Read-only.
 */

/** The Foundry link's query call (the backend's `foundryClient.query`). */
export type FoundryQuery = (method: string, data?: Record<string, unknown>) => Promise<unknown>;

const SESSION_ACTIONS = ['get', 'ready', 'end'] as const;

/** `session_switches`: an unknown action reads (`get`); only `ready` and `end` change anything. */
export async function handleSessionSwitches(
  query: FoundryQuery,
  params: unknown
): Promise<unknown> {
  const raw = (params as { action?: unknown } | null | undefined)?.action;
  const action = (SESSION_ACTIONS as readonly unknown[]).includes(raw) ? raw : 'get';
  return query('foundry-mcp-bridge.sessionSwitches', { action });
}

/** One feature switch as the dashboard's cards need it. */
export interface FeatureSwitch {
  id: string;
  name: string;
  enabled: boolean;
  /** "Apply without confirming" for features that have it (live play), else absent. */
  autoApply?: boolean;
}

export interface FeatureSwitchesResult {
  features: FeatureSwitch[];
  /** "Allow Write Operations". */
  writesAllowed: boolean;
}

/** `feature_switches`: the module's feature list, reduced to what the cards show. */
export async function handleFeatureSwitches(query: FoundryQuery): Promise<FeatureSwitchesResult> {
  const raw = await query('foundry-mcp-bridge.listGuardedFeatures');
  if (!Array.isArray(raw)) {
    const error = (raw as { error?: unknown } | null | undefined)?.error;
    throw new Error(typeof error === 'string' ? error : 'The module did not list its features');
  }
  const features: FeatureSwitch[] = [];
  let writesAllowed = true;
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    if (typeof f.id !== 'string') continue;
    if (f.writesAllowed === false) writesAllowed = false;
    features.push({
      id: f.id,
      name: typeof f.name === 'string' ? f.name : f.id,
      enabled: f.enabled === true,
      ...(typeof f.autoApply === 'boolean' ? { autoApply: f.autoApply } : {}),
    });
  }
  return { features, writesAllowed };
}
