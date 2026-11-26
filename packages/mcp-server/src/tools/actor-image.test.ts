/**
 * `plan-actor-image`: real temp folders for the path rules; Foundry and the guarded-write service
 * are stubs. Checks the allowed-folder rules, the switches, the upload request and the plan.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ACTOR_IMAGE_FEATURE_ID } from '@gnuminator/shared';

import { makeLogger } from '../test-support/stub-tool-deps.js';

// Lets one test swap the file right after the tool opened it (the swap-while-reading case).
const afterOpen = vi.hoisted(() => ({ run: undefined as undefined | (() => void) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>): ReturnType<typeof actual.open> => {
      const handle = await actual.open(...args);
      const run = afterOpen.run;
      afterOpen.run = undefined;
      run?.();
      return handle;
    },
  };
});

import {
  ActorImageTools,
  checkPathText,
  defaultImageRoots,
  isRefusedLinkTarget,
} from './actor-image.js';

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
let query: Mock;
let createPlan: Mock;
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
    logger: makeLogger(),
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

  // A symlink whose target text is a network path; it dangles here, and must not be resolved.
  let fileLinked = true;
  try {
    symlinkSync('//198.51.100.7/share/pic.png', join(root, 'unc.png'), 'file');
  } catch {
    fileLinked = false; // no symlink right on this PC
  }
  it.runIf(fileLinked)('refuses a link to a network share without following it', async () => {
    await expect(call({ actor: 'Ebbe', file: join(root, 'unc.png') })).rejects.toThrow(
      /not in an allowed folder/
    );
    expect(query).not.toHaveBeenCalled();
  });

  it.runIf(linked)(
    'follows a chain of local junctions hop by hop and still refuses the way out',
    async () => {
      const hop1 = join(root, 'hop1');
      const hop2 = join(root, 'hop2');
      symlinkSync(root, hop2, 'junction');
      symlinkSync(hop2, hop1, 'junction');
      await expect(call({ actor: 'Ebbe', file: join(hop1, 'ebbe.png') })).resolves.toMatchObject({
        planId: 'p1',
      });
      await expect(call({ actor: 'Ebbe', file: join(hop1, 'link', 'secret.png') })).rejects.toThrow(
        /not in an allowed folder/
      );
    }
  );

  it('refuses a picture that was swapped after it was opened', async () => {
    const file = join(root, 'swap.png');
    writeFileSync(file, PNG);
    afterOpen.run = (): void => {
      rmSync(file);
      writeFileSync(file, Buffer.concat([PNG, Buffer.from([9, 9])]));
    };
    await expect(call({ actor: 'Ebbe', file })).rejects.toThrow(/changed while it was being read/);
    expect(query).not.toHaveBeenCalledWith(
      'foundry-mcp-bridge.uploadActorImage',
      expect.anything(),
      expect.anything()
    );
  });

  it.runIf(linked)('reads a picture from an allowed folder that is itself a link', async () => {
    const via = join(base, 'via-link');
    symlinkSync(root, via, 'junction');
    tools = new ActorImageTools({
      foundryClient: { query },
      guardedWrites: { createPlan },
      logger: makeLogger(),
      roots: [via],
    });
    await expect(call({ actor: 'Ebbe', file: join(via, 'ebbe.png') })).resolves.toMatchObject({
      planId: 'p1',
    });
  });

  it('says to update the module when the module has no handler or no switch for it', async () => {
    query.mockImplementation((method: string) =>
      method === 'foundry-mcp-bridge.listGuardedFeatures'
        ? Promise.resolve([{ id: 'other-feature', enabled: true }])
        : Promise.reject(new Error(`No handler found for query: ${method}`))
    );
    await expect(call({ actor: 'Ebbe', file: join(root, 'ebbe.png') })).rejects.toThrow(
      /older than this tool; update the module/
    );
    query.mockImplementation((method: string) =>
      method === 'foundry-mcp-bridge.listGuardedFeatures'
        ? Promise.resolve([{ id: ACTOR_IMAGE_FEATURE_ID, enabled: true }])
        : Promise.reject(new Error(`Query ${method} failed: No handler found for query: ${method}`))
    );
    await expect(call({ actor: 'Ebbe', file: join(root, 'ebbe.png') })).rejects.toThrow(
      /older than this tool; update the module/
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

describe('checkPathText (Windows paths on every platform)', () => {
  const roots = ['C:\\Users\\gm\\Documents\\Foundry Art', 'D:\\Pics'];
  const verdict = (file: string): string => checkPathText(file, roots, path.win32);

  it('accepts files inside a folder, any case, either slash', () => {
    expect(verdict('C:\\Users\\gm\\Documents\\Foundry Art\\ebbe.png')).toBe('ok');
    expect(verdict('c:/users/gm/documents/foundry art/sub/ebbe.png')).toBe('ok');
    expect(verdict('D:\\Pics\\a.webp')).toBe('ok');
  });

  it('refuses UNC, device and extended-length paths', () => {
    for (const file of [
      '\\\\server\\share\\a.png',
      '\\\\?\\C:\\Users\\gm\\Documents\\Foundry Art\\a.png',
      '\\\\?\\UNC\\host\\share\\a.png',
      '\\\\.\\pipe\\x',
      '//server/share/a.png',
      '\\/host/share/a.png',
    ]) {
      expect(verdict(file)).toBe('denied');
    }
  });

  it('refuses drive-relative, relative, other-drive, parent and root-itself paths', () => {
    expect(verdict('C:ebbe.png')).toBe('relative');
    expect(verdict('ebbe.png')).toBe('relative');
    expect(verdict('E:\\Pics\\a.png')).toBe('denied');
    expect(verdict('C:\\Users\\gm\\Documents\\Foundry Art\\..\\secret.png')).toBe('denied');
    expect(verdict('C:\\Users\\gm\\Documents\\Foundry Art')).toBe('denied');
    expect(verdict('C:\\Users\\gm\\Documents\\Foundry Art Extra\\a.png')).toBe('denied');
  });

  it('lets a network path through when a folder is itself a network path', () => {
    expect(checkPathText('\\\\nas\\art\\a.png', ['\\\\nas\\art'], path.win32)).toBe('ok');
  });
});

describe('isRefusedLinkTarget', () => {
  it('refuses network and device targets, and on Windows any absolute target that is not a drive path', () => {
    expect(isRefusedLinkTarget('//host/share/x.png', path.win32)).toBe(true);
    expect(isRefusedLinkTarget('\\\\host\\share', path.win32)).toBe(true);
    expect(isRefusedLinkTarget('\\??\\UNC\\host\\share', path.win32)).toBe(true);
    expect(isRefusedLinkTarget('\\Windows\\System32', path.win32)).toBe(true);
    expect(isRefusedLinkTarget('C:\\art\\x.png', path.win32)).toBe(false);
    expect(isRefusedLinkTarget('d:/art/x.png', path.win32)).toBe(false);
    expect(isRefusedLinkTarget('..\\art\\x.png', path.win32)).toBe(false);
    expect(isRefusedLinkTarget('sub/x.png', path.win32)).toBe(false);
  });
  it('leaves absolute targets on other systems to the folder check', () => {
    expect(isRefusedLinkTarget('/tmp/art/x.png', path.posix)).toBe(false);
    expect(isRefusedLinkTarget('//host/share', path.posix)).toBe(true);
  });
});

describe('defaultImageRoots', () => {
  it('reads the semicolon list, keeps absolute folders only, else one default folder', () => {
    const art = join(base, 'Art');
    const more = join(base, 'More');
    expect(
      defaultImageRoots({ FOUNDRY_AI_TOOL_IMAGE_ROOTS: `${art}; relative ;${more}` } as any)
    ).toEqual([art, more]);
    // The moved folder exists, so the data folder wins over a real Documents\Foundry Art.
    mkdirSync(join(base, 'Data', 'Foundry Art'), { recursive: true });
    const fallback = defaultImageRoots({ FVTT_DATA_DIR: join(base, 'Data') });
    expect(fallback).toEqual([join(base, 'Data', 'Foundry Art')]);
  });

  it('puts Foundry Art in the data folder, and the env list still wins', () => {
    const data = join(base, 'DataSet');
    mkdirSync(join(data, 'Foundry Art'), { recursive: true });
    expect(defaultImageRoots({ FVTT_DATA_DIR: data } as any)).toEqual([join(data, 'Foundry Art')]);
    const art = join(base, 'Art');
    expect(
      defaultImageRoots({ FOUNDRY_AI_TOOL_IMAGE_ROOTS: art, FVTT_DATA_DIR: data } as any)
    ).toEqual([art]);
  });

  it('falls back to an absolute Foundry Art folder when FVTT_DATA_DIR is unset', () => {
    const roots = defaultImageRoots({});
    expect(roots).toHaveLength(1);
    expect(path.isAbsolute(roots[0])).toBe(true);
    expect(path.basename(roots[0])).toBe('Foundry Art');
  });

  it('turns a relative FVTT_DATA_DIR into an absolute root', () => {
    const roots = defaultImageRoots({ FVTT_DATA_DIR: 'rel-data' });
    expect(roots.every(r => path.isAbsolute(r))).toBe(true);
  });
});
