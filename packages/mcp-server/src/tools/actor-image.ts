import { lstat, open, readlink, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { isAbsolute, join } from 'node:path';
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
const MODULE_TOO_OLD =
  'The Foundry AI Tool module in this world is older than this tool; update the module and reload Foundry.';

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

/** The parts of `node:path` the text checks use; `path.win32` and `path.posix` both fit. */
export type PathModule = Pick<typeof path, 'isAbsolute' | 'relative' | 'resolve' | 'sep'>;

/** A network (UNC) or device path: Windows connects out just by looking such a path up. */
export function isNetworkPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//') || p.startsWith('\\??\\');
}

function inside(mod: PathModule, root: string, file: string): boolean {
  const rel = mod.relative(root, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${mod.sep}`) && !mod.isAbsolute(rel);
}

/**
 * The text-only part of the folder check, before any file system call: 'relative' when the path
 * is not absolute, 'denied' for a network or device path (unless a folder is one) and for a path
 * outside every folder, else 'ok'. Pure, with the path module passed in, so the Windows cases
 * run on every platform (`path.win32`).
 */
export function checkPathText(
  file: string,
  roots: string[],
  mod: PathModule = path
): 'ok' | 'relative' | 'denied' {
  if (!mod.isAbsolute(file)) return 'relative';
  if (isNetworkPath(file) && !roots.some(isNetworkPath)) return 'denied';
  const wanted = mod.resolve(file);
  return roots.some(root => inside(mod, mod.resolve(root), wanted)) ? 'ok' : 'denied';
}

/**
 * Walk the path one part at a time with `lstat`, never following a link by itself: a link (or
 * junction) whose target is a network path is refused before `realpath` could connect to it.
 * Other links are followed by hand (at most 40), so a chain is checked hop by hop.
 */
async function refuseNetworkLinks(file: string, notAllowed: Error): Promise<void> {
  const split = (p: string): { root: string; parts: string[] } => {
    const root = path.parse(p).root;
    return { root, parts: p.slice(root.length).split(path.sep).filter(Boolean) };
  };
  let { root: acc, parts } = split(path.resolve(file));
  let hops = 0;
  for (let i = 0; i < parts.length; i++) {
    const next = path.join(acc, parts[i] ?? '');
    let link: boolean;
    try {
      link = (await lstat(next)).isSymbolicLink();
    } catch {
      return; // missing: the realpath that follows reports it
    }
    if (!link) {
      acc = next;
      continue;
    }
    if (++hops > 40) throw notAllowed;
    const target = await readlink(next);
    if (isNetworkPath(target)) throw notAllowed;
    const resolved = split(path.resolve(acc, target));
    acc = resolved.root;
    parts = [...resolved.parts, ...parts.slice(i + 1)];
    i = -1;
  }
}

/**
 * The picture's real path when it is a regular file inside an allowed folder, else throws.
 * Symlinks, junctions and `..` are resolved first, so a link cannot point out of a folder.
 */
export async function checkImagePath(file: string, roots: string[]): Promise<string> {
  const text = checkPathText(file, roots);
  if (text === 'relative') throw new Error('file must be an absolute path on this PC.');
  const notAllowed = new Error(
    `That file is not in an allowed folder. Allowed: ${roots.join('; ')}. Put the picture there, or list more folders in ${ACTOR_IMAGE_ROOTS_ENV}.`
  );
  // Before any filesystem call: a path outside every folder must not even be probed.
  if (text === 'denied') throw notAllowed;
  // A link to a network share would make realpath connect out (and send the Windows login hash).
  if (!roots.some(isNetworkPath)) await refuseNetworkLinks(file, notAllowed);
  let real: string;
  try {
    real = await realpath(path.resolve(file));
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
    if (inside(path, realRoot, real)) {
      if (!(await stat(real)).isFile()) throw new Error('file must be a picture file.');
      return real;
    }
  }
  throw notAllowed;
}

const TOO_BIG = 'That picture is too big. The limit is 5 MB.';

/**
 * Read the checked file. The size is taken from the open file and again from the bytes, and the
 * path is resolved again after the open, so a file swapped after `checkImagePath` is refused.
 */
async function readPicture(real: string, roots: string[]): Promise<Uint8Array> {
  const handle = await open(real, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('file must be a picture file.');
    if (info.size > PORTRAIT_MAX_BYTES) throw new Error(TOO_BIG);
    if ((await checkImagePath(real, roots)) !== real) {
      throw new Error('The picture changed while it was being read. Try again.');
    }
    const bytes = await handle.readFile();
    if (bytes.length > PORTRAIT_MAX_BYTES) throw new Error(TOO_BIG);
    return new Uint8Array(bytes);
  } finally {
    await handle.close();
  }
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
          "Plan a new portrait and/or token picture for an actor from a PNG, JPG or WebP file (max 5 MB) in an allowed folder on the GM's PC. The file is stored in the world's assets/ai-art folder; apply with apply-planned-change, revert with undo-change (the old paths come back, the file stays; a plan that is never applied also leaves its file there). Tokens already placed on scenes keep their picture.",
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
    const roots = this.roots ?? defaultImageRoots();
    const real = await checkImagePath(params.file, roots);
    const bytes = await readPicture(real, roots);
    const type = sniffPortraitType(bytes);
    if (!type) throw new Error('Only PNG, JPG or WebP pictures work.');

    // The switches first, so a refused write does not leave a stray file behind.
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    const feature = features.find(f => f.id === ACTOR_IMAGE_FEATURE_ID);
    if (!feature) throw new Error(MODULE_TOO_OLD);
    if (!feature.enabled) throw new Error(SWITCH_OFF);
    if (features.some(f => f.writesAllowed === false)) {
      throw new Error(
        'Changes to Foundry are switched off ("AI Tool: Allow Write Operations"). Ask the GM to turn it on.'
      );
    }

    let reply: UploadActorImageReply;
    try {
      reply = await this.foundryClient.query(
        'foundry-mcp-bridge.uploadActorImage',
        { actor: params.actor, type, data: Buffer.from(bytes).toString('base64') },
        { timeoutMs: UPLOAD_TIMEOUT_MS }
      );
    } catch (error) {
      // A module from before this tool has no handler for the query.
      if (error instanceof Error && /No handler found for query/i.test(error.message)) {
        throw new Error(MODULE_TOO_OLD, { cause: error });
      }
      throw error;
    }
    const stored = unwrapBridgeReply(reply, 'Could not store the picture');
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
