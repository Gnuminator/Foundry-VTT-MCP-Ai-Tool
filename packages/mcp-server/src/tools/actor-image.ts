import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  ACTOR_IMAGE_FEATURE_ID,
  ACTOR_IMAGE_ROOTS_ENV,
  ACTOR_IMAGE_TARGETS,
  PORTRAIT_MAX_BYTES,
  featureSwitchOff,
  sniffPortraitType,
  toolRef,
  unwrapBridgeReply,
  type GuardedOp,
  type UploadActorImageReply,
} from '@gnuminator/shared';
import type { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import type { Logger } from '../logger.js';

export interface ActorImageToolsOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
  /** Allowed folders; default: FOUNDRY_AI_TOOL_IMAGE_ROOTS, else Documents\Foundry Art. */
  roots?: string[];
}

const UPLOAD_TIMEOUT_MS = 60_000;
const SWITCH_OFF = featureSwitchOff('Actor images', 'AI Tool: Actor images (writes)');

const planParams = z.object({
  actor: z.string().min(1),
  file: z.string().min(1),
  slot: z.enum(ACTOR_IMAGE_TARGETS).default('both'),
});

/** The folders pictures may be read from: the env list (semicolons), else one default folder. */
export function defaultImageRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = (env[ACTOR_IMAGE_ROOTS_ENV] ?? '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => isAbsolute(s));
  return listed.length > 0 ? listed : [join(homedir(), 'Documents', 'Foundry Art')];
}

function inside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * The picture's real path when it is a regular file inside an allowed folder, else throws.
 * Symlinks, junctions and `..` are resolved first, so a link cannot point out of a folder.
 */
export async function checkImagePath(file: string, roots: string[]): Promise<string> {
  if (!isAbsolute(file)) throw new Error('file must be an absolute path on this PC.');
  const notAllowed = new Error(
    `That file is not in an allowed folder. Allowed: ${roots.join('; ')}. Put the picture there, or list more folders in ${ACTOR_IMAGE_ROOTS_ENV}.`
  );
  // Before any filesystem call: a network (UNC) or device path would make Windows connect out
  // just by being looked at, and a path outside every folder must not even be probed.
  const isNetwork = (p: string): boolean => p.startsWith('\\\\') || p.startsWith('//');
  if (isNetwork(file) && !roots.some(isNetwork)) throw notAllowed;
  const wanted = resolve(file);
  if (!roots.some(root => inside(resolve(root), wanted))) throw notAllowed;
  let real: string;
  try {
    real = await realpath(resolve(file));
  } catch {
    throw new Error(`No such file: ${file}`);
  }
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      continue;
    }
    if (inside(realRoot, real)) {
      if (!(await stat(real)).isFile()) throw new Error('file must be a picture file.');
      return real;
    }
  }
  throw notAllowed;
}

/**
 * `plan-actor-image`: put a portrait and/or token picture on an actor from a file on the PC.
 * The file must sit in an allowed folder and be a PNG, JPG or WebP up to 5 MB. The module stores
 * it under assets/ai-art/<actor>/; the actor change is one guarded plan (apply with
 * apply-planned-change, undo with undo-change, which puts the old paths back; the file stays).
 */
export class ActorImageTools {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private readonly logger: Logger;
  private readonly roots: string[] | undefined;

  constructor(options: ActorImageToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'ActorImageTools' });
    this.roots = options.roots;
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'plan-actor-image',
        description:
          "Plan a new portrait and/or token picture for an actor from a PNG, JPG or WebP file (max 5 MB) in an allowed folder on the GM's PC. The file is stored in the world's assets/ai-art folder; apply with apply-planned-change, revert with undo-change (the old paths come back, the file stays). Tokens already placed on scenes keep their picture.",
        inputSchema: {
          type: 'object',
          properties: {
            actor: { type: 'string', description: 'Actor name or id.', ...toolRef('actor', 'id') },
            file: {
              type: 'string',
              description: 'Absolute path of the picture on this PC, inside an allowed folder.',
            },
            slot: {
              type: 'string',
              enum: [...ACTOR_IMAGE_TARGETS],
              description: 'portrait, token or both (default).',
            },
          },
          required: ['actor', 'file'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: unknown): Promise<PlanView & Record<string, unknown>> {
    try {
      if (name !== 'plan-actor-image') throw new Error(`Unknown actor image tool: ${name}`);
      return await this.plan(args);
    } catch (error) {
      this.logger.error(`Error in actor image tool ${name}:`, error);
      throw error;
    }
  }

  private async plan(args: unknown): Promise<PlanView & Record<string, unknown>> {
    const params = planParams.parse(args ?? {});
    const real = await checkImagePath(params.file, this.roots ?? defaultImageRoots());
    const size = (await stat(real)).size;
    if (size > PORTRAIT_MAX_BYTES) throw new Error('That picture is too big. The limit is 5 MB.');
    const bytes = new Uint8Array(await readFile(real));
    const type = sniffPortraitType(bytes);
    if (!type) throw new Error('Only PNG, JPG or WebP pictures work.');

    // The switches first, so a refused write does not leave a stray file behind.
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    if (!features.find(f => f.id === ACTOR_IMAGE_FEATURE_ID)?.enabled) {
      throw new Error(SWITCH_OFF);
    }
    if (features.some(f => f.writesAllowed === false)) {
      throw new Error(
        'Changes to Foundry are switched off ("AI Tool: Allow Write Operations"). Ask the GM to turn it on.'
      );
    }

    const stored = unwrapBridgeReply(
      (await this.foundryClient.query(
        'foundry-mcp-bridge.uploadActorImage',
        { actor: params.actor, type, data: Buffer.from(bytes).toString('base64') },
        { timeoutMs: UPLOAD_TIMEOUT_MS }
      )) as UploadActorImageReply,
      'Could not store the picture'
    );
    if (stored.success !== true || !stored.path || !stored.actorId) {
      throw new Error(stored.error || 'Could not store the picture.');
    }

    const changes: Record<string, unknown> = {};
    const pathLabels: Record<string, string> = {};
    if (params.slot !== 'token') {
      changes['img'] = stored.path;
      pathLabels['img'] = 'portrait';
    }
    if (params.slot !== 'portrait') {
      changes['prototypeToken.texture.src'] = stored.path;
      pathLabels['prototypeToken.texture.src'] = 'token picture';
    }
    const ops: GuardedOp[] = [{ kind: 'update', uuid: `Actor.${stored.actorId}`, changes }];
    const label = params.slot === 'both' ? 'portrait and token picture' : `${params.slot} picture`;
    const plan = await this.guardedWrites.createPlan({
      feature: ACTOR_IMAGE_FEATURE_ID,
      summary: `New ${label} for ${stored.actorName} (${stored.path})`,
      ops,
      pathLabels,
    });
    return {
      ...plan,
      actorName: stored.actorName,
      path: stored.path,
      slot: params.slot,
      was: { portrait: stored.currentImg ?? '', token: stored.currentTokenImg ?? '' },
      autoApply: false,
    };
  }
}
