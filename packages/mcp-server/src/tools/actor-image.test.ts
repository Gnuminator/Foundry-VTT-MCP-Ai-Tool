/**
 * `plan-actor-image`: real temp folders for the path rules; Foundry and the guarded-write service
 * are stubs. Checks the allowed-folder rules, the switches, the upload request and the plan.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTOR_IMAGE_FEATURE_ID } from '@gnuminator/shared';

import { ActorImageTools, defaultImageRoots } from './actor-image.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const base = mkdtempSync(join(tmpdir(), 'actor-image-'));
const root = join(base, 'art');
const outside = join(base, 'outside');
mkdirSync(root);
mkdirSync(outside);
writeFileSync(join(root, 'ebbe.png'), PNG);
writeFileSync(join(root, 'notes.png'), 'not a picture at all');
writeFileSync(join(root, 'big.png'), Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
writeFileSync(join(outside, 'secret.png'), PNG);
let linked = true;
try {
  symlinkSync(outside, join(root, 'link'), 'junction');
} catch {
  linked = false;
}
afterAll(() => rmSync(base, { recursive: true, force: true }));

let enabled: boolean;
let writesAllowed: boolean;
let query: ReturnType<typeof vi.fn>;
let createPlan: ReturnType<typeof vi.fn>;
let tools: ActorImageTools;

beforeEach(() => {
  enabled = true;
  writesAllowed = true;
  query = vi.fn((method: string) => {
    if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
      return Promise.resolve([{ id: ACTOR_IMAGE_FEATURE_ID, enabled, writesAllowed }]);
    }
    return Promise.resolve({
      success: true,
      path: 'assets/ai-art/ebbe-actor1/art-1.png',
      actorId: 'actor00000000001',
      actorName: 'Ebbe',
      currentImg: 'old.webp',
      currentTokenImg: 'oldtoken.webp',
    });
  });
  createPlan = vi.fn((input: { feature: string; summary: string }) =>
    Promise.resolve({ planId: 'p1', feature: input.feature, summary: input.summary, risk: 'write' })
  );
  tools = new ActorImageTools({
    foundryClient: { query },
    guardedWrites: { createPlan },
    logger: logger(),
    roots: [root],
  });
});

const call = (args: unknown): Promise<any> => tools.handleToolCall('plan-actor-image', args);

describe('plan-actor-image', () => {
  it('uploads the file and plans img and token for target both (the default)', async () => {
    const result = await call({ actor: 'Ebbe', file: join(root, 'ebbe.png') });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.uploadActorImage',
      { actor: 'Ebbe', type: 'png', data: PNG.toString('base64') },
      { timeoutMs: 60_000 }
    );
    expect(createPlan).toHaveBeenCalledWith({
      feature: ACTOR_IMAGE_FEATURE_ID,
      summary: 'New portrait and token picture for Ebbe (assets/ai-art/ebbe-actor1/art-1.png)',
      ops: [
        {
          kind: 'update',
          uuid: 'Actor.actor00000000001',
          changes: {
            img: 'assets/ai-art/ebbe-actor1/art-1.png',
            'prototypeToken.texture.src': 'assets/ai-art/ebbe-actor1/art-1.png',
          },
        },
      ],
      pathLabels: { img: 'portrait', 'prototypeToken.texture.src': 'token picture' },
    });
    expect(result).toMatchObject({
      planId: 'p1',
      slot: 'both',
      was: { portrait: 'old.webp', token: 'oldtoken.webp' },
      autoApply: false,
    });
  });

  it('changes only the token for target token and only the portrait for portrait', async () => {
    await call({ actor: 'Ebbe', file: join(root, 'ebbe.png'), slot: 'token' });
    expect(createPlan.mock.calls[0]?.[0].ops[0].changes).toEqual({
      'prototypeToken.texture.src': 'assets/ai-art/ebbe-actor1/art-1.png',
    });
    await call({ actor: 'Ebbe', file: join(root, 'ebbe.png'), slot: 'portrait' });
    expect(createPlan.mock.calls[1]?.[0].ops[0].changes).toEqual({
      img: 'assets/ai-art/ebbe-actor1/art-1.png',
    });
  });

  it('refuses files outside the allowed folders, relative paths, ".." and missing files', async () => {
    await expect(call({ actor: 'Ebbe', file: join(outside, 'secret.png') })).rejects.toThrow(
      /not in an allowed folder/
    );
    await expect(
      call({ actor: 'Ebbe', file: join(root, '..', 'outside', 'secret.png') })
    ).rejects.toThrow(/not in an allowed folder/);
    await expect(call({ actor: 'Ebbe', file: 'ebbe.png' })).rejects.toThrow(/absolute path/);
    await expect(call({ actor: 'Ebbe', file: join(root, 'nope.png') })).rejects.toThrow(
      /No such file/
    );
    await expect(call({ actor: 'Ebbe', file: root })).rejects.toThrow(/not in an allowed folder/);
    mkdirSync(join(root, 'sub'), { recursive: true });
    await expect(call({ actor: 'Ebbe', file: join(root, 'sub') })).rejects.toThrow(/picture file/);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a network or device path before touching the file system', async () => {
    const files = ['//host/share/a.png'];
    // Backslash network paths are only absolute paths on Windows.
    if (process.platform === 'win32') files.push('\\\\203.0.113.5\\share\\a.png', '\\\\.\\pipe\\x');
    for (const file of files) {
      await expect(call({ actor: 'Ebbe', file })).rejects.toThrow(/not in an allowed folder/);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it.runIf(linked)('refuses a link that points out of the folder', async () => {
    await expect(call({ actor: 'Ebbe', file: join(root, 'link', 'secret.png') })).rejects.toThrow(
      /not in an allowed folder/
    );
  });

  it('refuses a non-picture and an oversized picture before anything is sent', async () => {
    await expect(call({ actor: 'Ebbe', file: join(root, 'notes.png') })).rejects.toThrow(
      /Only PNG, JPG or WebP/
    );
    await expect(call({ actor: 'Ebbe', file: join(root, 'big.png') })).rejects.toThrow(/too big/);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses when the feature switch or the write switch is off, before uploading', async () => {
    enabled = false;
    await expect(call({ actor: 'Ebbe', file: join(root, 'ebbe.png') })).rejects.toThrow(
      /Actor images is switched off/
    );
    enabled = true;
    writesAllowed = false;
    await expect(call({ actor: 'Ebbe', file: join(root, 'ebbe.png') })).rejects.toThrow(
      /Allow Write Operations/
    );
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.uploadActorImage',
      expect.anything(),
      expect.anything()
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('passes on the module refusal and plans nothing', async () => {
    query.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'foundry-mcp-bridge.listGuardedFeatures'
          ? [{ id: ACTOR_IMAGE_FEATURE_ID, enabled: true }]
          : { success: false, error: 'No actor "Ebbe".' }
      )
    );
    await expect(call({ actor: 'Ebbe', file: join(root, 'ebbe.png') })).rejects.toThrow(/No actor/);
    expect(createPlan).not.toHaveBeenCalled();
  });
});

describe('defaultImageRoots', () => {
  it('reads the semicolon list, keeps absolute folders only, else one default folder', () => {
    const art = join(base, 'Art');
    const more = join(base, 'More');
    expect(
      defaultImageRoots({ FOUNDRY_AI_TOOL_IMAGE_ROOTS: `${art}; relative ;${more}` } as any)
    ).toEqual([art, more]);
    const fallback = defaultImageRoots({});
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatch(/Foundry Art$/);
  });
});
