import {
  PREFLIGHT_QUERY,
  TOOL_VERSION,
  type GuardedFeatureState,
  type PreflightCheck,
  type PreflightChecksResult,
  type PreflightScan,
  type PreflightScanResult,
} from '@gnuminator/shared';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { Logger } from '../logger.js';
import type { SecretTermsService } from '../secret-terms.js';
import type { WorldIdResolver } from '../vault/world-id.js';
import type { PlaySessionTools } from './play-session.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface PreflightToolsOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected' | 'getConnectionInfo'>;
  secretTerms: Pick<SecretTermsService, 'findSecretTermsInMany'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  playSession: Pick<PlaySessionTools, 'handleGetPlaySession'>;
  /** FOUNDRY_AI_OBSIDIAN_DIR is set (Obsidian notes render). */
  obsidianVaultDirSet: boolean;
  logger: Logger;
  /** Tests only: the bridge's version (default: the shared TOOL_VERSION). */
  bridgeVersion?: string;
}

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `get-preflight` (I-068 with I-067 and I-076): the checks before a session.
 * Read-only: it reads the Foundry link, the module's switches and the
 * pre-flight scan (secret-looking world settings, names players can see,
 * module conflicts), and runs the secret terms over those names.
 */
export class PreflightTools {
  private readonly options: PreflightToolsOptions;
  private readonly logger: Logger;
  private readonly bridgeVersion: string;

  constructor(options: PreflightToolsOptions) {
    this.options = options;
    this.logger = options.logger.child({ component: 'PreflightTools' });
    this.bridgeVersion = options.bridgeVersion ?? TOOL_VERSION;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get-preflight',
        description:
          'GM ONLY. Pre-flight check before a session. action "checks" (default): one checklist with ok, warn, fail or info per item: Foundry link, module and bridge versions match, "Allow Write Operations" and the feature switches, secrets in world settings (every player can read those), names players can see that match a secret term (playlists, sounds, scenes, tokens, journals, actors), module conflicts, Obsidian notes, play session; ready is true when nothing failed. action "scan": the findings behind those items. Secret values are masked, never returned. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['checks', 'scan'],
              description: '"checks" (default) for the checklist, "scan" for the findings only.',
            },
          },
        },
      },
    ];
  }

  async handleGetPreflight(args: unknown): Promise<PreflightChecksResult | PreflightScanResult> {
    const { action } = z
      .object({ action: z.enum(['checks', 'scan']).default('checks') })
      .parse(args ?? {});
    if (action === 'scan') return this.scan();
    return this.checks();
  }

  /** The module scan plus the secret-term match over the names players can see. */
  async scan(): Promise<PreflightScanResult> {
    const raw = unwrap<PreflightScan>(
      await this.options.foundryClient.query(`foundry-mcp-bridge.${PREFLIGHT_QUERY}`, {}),
      'Pre-flight scan refused'
    );
    const names = Array.isArray(raw?.names) ? raw.names : [];
    const worldId = await this.options.worldIds.current();
    const matches = await this.options.secretTerms.findSecretTermsInMany(
      worldId,
      names.map(n => n.name)
    );
    return {
      computedAt: typeof raw?.computedAt === 'number' ? raw.computedAt : Date.now(),
      settingsChecked: typeof raw?.settingsChecked === 'number' ? raw.settingsChecked : 0,
      settings: Array.isArray(raw?.settings) ? raw.settings : [],
      namesChecked: names.length,
      names: names.flatMap((name, i) => {
        const terms = [...new Set((matches[i] ?? []).map(m => m.term))];
        return terms.length > 0 ? [{ ...name, terms }] : [];
      }),
      modules: Array.isArray(raw?.modules) ? raw.modules : [],
    };
  }

  async checks(): Promise<PreflightChecksResult> {
    const client = this.options.foundryClient;
    const connected = client.isConnected();
    const info = (client.getConnectionInfo() ?? {}) as {
      moduleVersion?: unknown;
      userName?: unknown;
    };
    const moduleVersion =
      typeof info.moduleVersion === 'string' && info.moduleVersion !== 'unknown'
        ? info.moduleVersion
        : null;
    const checks: PreflightCheck[] = [];

    checks.push(
      connected
        ? {
            id: 'foundry-link',
            label: 'Foundry connected',
            status: 'ok',
            detail:
              typeof info.userName === 'string' && info.userName
                ? `Connected through ${info.userName}.`
                : 'Connected.',
          }
        : {
            id: 'foundry-link',
            label: 'Foundry connected',
            status: 'fail',
            detail:
              'Foundry is not connected. Open the world in your browser and join as your GM user, then wait for "MCP Bridge connected successfully".',
          }
    );
    checks.push(this.versionCheck(connected, moduleVersion));

    let scan: PreflightScanResult | null = null;
    if (connected) {
      const [features, scanned] = await Promise.allSettled([
        client.query('foundry-mcp-bridge.listGuardedFeatures'),
        this.scan(),
      ]);
      checks.push(this.switchesCheck(features));
      if (scanned.status === 'fulfilled') {
        scan = scanned.value;
        checks.push(...this.scanChecks(scan));
      } else {
        this.logger.warn('Pre-flight scan failed', { error: message(scanned.reason) });
        const detail = `The scan did not run: ${message(scanned.reason)}`;
        checks.push(
          {
            id: 'world-settings',
            label: 'No secrets in world settings',
            status: 'unknown',
            detail,
          },
          {
            id: 'visible-names',
            label: 'No spoilers in names players see',
            status: 'unknown',
            detail,
          },
          { id: 'modules', label: 'No module conflicts', status: 'unknown', detail }
        );
      }
    } else {
      const detail = 'Needs the Foundry link.';
      checks.push(
        { id: 'write-switches', label: 'Write switches', status: 'unknown', detail },
        { id: 'world-settings', label: 'No secrets in world settings', status: 'unknown', detail },
        {
          id: 'visible-names',
          label: 'No spoilers in names players see',
          status: 'unknown',
          detail,
        },
        { id: 'modules', label: 'No module conflicts', status: 'unknown', detail }
      );
    }

    checks.push(
      this.options.obsidianVaultDirSet
        ? {
            id: 'obsidian',
            label: 'Obsidian notes',
            status: 'ok',
            detail: 'The Obsidian folder is set; notes render after changes.',
          }
        : {
            id: 'obsidian',
            label: 'Obsidian notes',
            status: 'info',
            detail:
              'No Obsidian folder is set, so no notes are written. Fine if you do not use Obsidian.',
          }
    );
    checks.push(await this.playSessionCheck());

    return {
      ready: !checks.some(c => c.status === 'fail'),
      checks,
      scan,
      bridgeVersion: this.bridgeVersion,
      moduleVersion,
    };
  }

  private versionCheck(connected: boolean, moduleVersion: string | null): PreflightCheck {
    const label = 'Module and bridge versions match';
    if (!connected || moduleVersion === null) {
      return {
        id: 'versions',
        label,
        status: 'unknown',
        detail: connected
          ? `The module did not report its version (bridge ${this.bridgeVersion}).`
          : `Needs the Foundry link (bridge ${this.bridgeVersion}).`,
      };
    }
    if (moduleVersion === this.bridgeVersion) {
      return { id: 'versions', label, status: 'ok', detail: `Both are ${moduleVersion}.` };
    }
    return {
      id: 'versions',
      label,
      status: 'fail',
      detail: `The Foundry module is ${moduleVersion} but the bridge is ${this.bridgeVersion}. Update the older one (Foundry's Add-on Modules tab, or the installer) so both match.`,
    };
  }

  private switchesCheck(result: PromiseSettledResult<unknown>): PreflightCheck {
    const label = 'Write switches';
    if (result.status === 'rejected') {
      return {
        id: 'write-switches',
        label,
        status: 'unknown',
        detail: `Could not read the switches: ${message(result.reason)}`,
      };
    }
    let features: GuardedFeatureState[];
    try {
      features = unwrap<GuardedFeatureState[]>(result.value, 'Feature list refused');
    } catch (error) {
      return { id: 'write-switches', label, status: 'unknown', detail: message(error) };
    }
    const list = Array.isArray(features) ? features : [];
    const writesOff = list.some(f => f.writesAllowed === false);
    const on = list.filter(f => f.enabled === true).map(f => f.name);
    const switchedOn =
      on.length > 0 ? `Feature switches on: ${on.join(', ')}.` : 'No feature switch is on.';
    return {
      id: 'write-switches',
      label,
      status: 'info',
      detail: writesOff
        ? `"Allow Write Operations" is off, so neither Claude nor the dashboard can change anything. ${switchedOn}`
        : `"Allow Write Operations" is on. ${switchedOn} Switch on only what you use tonight.`,
    };
  }

  private scanChecks(scan: PreflightScanResult): PreflightCheck[] {
    const failing = scan.settings.filter(s => s.severity === 'fail');
    const warning = scan.settings.filter(s => s.severity === 'warn');
    const settingsList = (list: typeof scan.settings): string =>
      list.map(s => s.setting).join(', ');
    const settings: PreflightCheck =
      failing.length > 0
        ? {
            id: 'world-settings',
            label: 'No secrets in world settings',
            status: 'fail',
            detail: `${plural(failing.length, 'world setting')} every player can read ${failing.length === 1 ? 'holds' : 'hold'} a secret: ${settingsList(failing)}. See the scan for what to do.`,
          }
        : warning.length > 0
          ? {
              id: 'world-settings',
              label: 'No secrets in world settings',
              status: 'warn',
              detail: `${plural(warning.length, 'world setting')} ${warning.length === 1 ? 'looks' : 'look'} like a secret: ${settingsList(warning)}.`,
            }
          : {
              id: 'world-settings',
              label: 'No secrets in world settings',
              status: 'ok',
              detail: `Checked ${plural(scan.settingsChecked, 'world setting')}.`,
            };

    const names: PreflightCheck =
      scan.names.length > 0
        ? {
            id: 'visible-names',
            label: 'No spoilers in names players see',
            status: 'fail',
            detail: `Players can see ${plural(scan.names.length, 'name')} with a secret term: ${scan.names
              .map(n => `${n.kind} "${n.name}"`)
              .join(', ')}. Rename them, give the scene a navigation name, or hide them.`,
          }
        : {
            id: 'visible-names',
            label: 'No spoilers in names players see',
            status: 'ok',
            detail: `Checked ${plural(scan.namesChecked, 'name')} players can see.`,
          };

    const warnModules = scan.modules.filter(m => m.severity !== 'info');
    const modules: PreflightCheck =
      scan.modules.length === 0
        ? {
            id: 'modules',
            label: 'No module conflicts',
            status: 'ok',
            detail: 'No known conflicts.',
          }
        : {
            id: 'modules',
            label: 'No module conflicts',
            status: warnModules.length > 0 ? 'warn' : 'info',
            detail: scan.modules.map(m => `${m.title}: ${m.reason}`).join(' '),
          };
    return [settings, names, modules];
  }

  private async playSessionCheck(): Promise<PreflightCheck> {
    const label = 'Play session';
    try {
      const session = await this.options.playSession.handleGetPlaySession({});
      if (session.open) {
        return {
          id: 'play-session',
          label,
          status: 'ok',
          detail: session.startedAt ? `Started ${session.startedAt}.` : 'Started.',
        };
      }
      return {
        id: 'play-session',
        label,
        status: 'info',
        detail: 'Not started yet. Click Start session in the dashboard header when play begins.',
      };
    } catch (error) {
      return { id: 'play-session', label, status: 'unknown', detail: message(error) };
    }
  }
}
