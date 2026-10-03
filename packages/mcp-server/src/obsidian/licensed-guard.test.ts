/**
 * The git guard for licensed content (design 13.4): Library notes and image copies need their
 * folders ignored, licensed text in world notes needs the whole mirror folder (and its trash)
 * ignored, and every git failure fails closed. These tests use the real `git` when it is
 * installed (CI has it) and stand-ins for the failure cases.
 */
import { execFileSync } from 'child_process';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  completeGitignore,
  findGitRoot,
  LICENSED_GITIGNORE,
  LicensedGuard,
  runGit,
  type GitRunner,
} from './licensed-guard.js';

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const gitIt = hasGit() ? it : it.skip;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

let dir: string;
let vault: string;
let campaign: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'licensed-guard-'));
  vault = path.join(dir, 'vault');
  campaign = path.join(vault, 'Campaigns', 'test-world');
  await fsp.mkdir(campaign, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

async function write(rel: string, text: string, root = campaign): Promise<void> {
  const full = path.join(root, ...rel.split('/'));
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, text, 'utf8');
}

describe('completeGitignore', () => {
  it('writes both rules into an empty file, with a header that says why', () => {
    const text = completeGitignore(null) ?? '';
    expect(text).toContain('/Library/');
    expect(text).toContain('/Attachments/');
    expect(text).toContain('licensed');
  });

  it('keeps the GM lines and adds only what is missing', () => {
    const text = completeGitignore('*.tmp\n/Library/\n') ?? '';
    expect(text.startsWith('*.tmp\n/Library/\n')).toBe(true);
    expect(text.match(/\/Library\//g)).toHaveLength(1);
    expect(text).toContain('/Attachments/');
    expect(completeGitignore(text)).toBeNull();
  });

  it('never adds a rule for the whole mirror folder', () => {
    expect(completeGitignore(null)).not.toMatch(/^\/?AI Tool\/?$/m);
  });
});

describe('LicensedGuard outside a repository', () => {
  it('allows everything and writes the ignore file anyway', async () => {
    const never: GitRunner = () =>
      Promise.reject(new Error('git must not run outside a repository'));
    // A temp dir could sit inside a repository on some machines: only assert when it does not.
    if ((await findGitRoot(campaign)) !== null) return;
    const result = await new LicensedGuard(campaign, never).check();
    expect(result).toEqual({
      ok: true,
      reason: null,
      repo: null,
      licensedOk: true,
      licensedReason: null,
      trashOk: true,
      trashReason: null,
    });
    const text = await fsp.readFile(path.join(campaign, ...LICENSED_GITIGNORE.split('/')), 'utf8');
    expect(completeGitignore(text)).toBeNull();
  });

  it('finds a .git below the campaign folder, inside AI Tool/, and turns everything off', async () => {
    await fsp.mkdir(path.join(campaign, 'AI Tool', 'Foundry', '.git'), { recursive: true });
    const result = await new LicensedGuard(campaign, runGit).check();
    expect(result.ok).toBe(false);
    expect(result.licensedOk).toBe(false);
    expect(result.trashOk).toBe(false);
    expect(result.reason).toContain('AI Tool/Foundry/.git');
  });
});

describe('LicensedGuard inside a repository (real git)', () => {
  gitIt(
    'allows the Library when only its folders are ignored, but withholds world text',
    async () => {
      git(vault, 'init', '-q');
      const result = await new LicensedGuard(campaign, runGit).check();
      expect(result.ok).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.licensedOk).toBe(false);
      expect(result.licensedReason).toContain('does not ignore the mirror folder');
      expect(result.trashOk).toBe(false);
      // What the mirror writes: Library notes and image copies stay out of git.
      await write('AI Tool/Library/Monsters/Snow Weasel.md', 'made-up note\n');
      await write('AI Tool/Attachments/maps/town.png', 'not really a png\n');
      await write('AI Tool/Foundry/NPCs/Wolf.md', 'a mirror note without licensed text\n');
      const status = git(vault, 'status', '--porcelain', '-uall');
      expect(status).not.toContain('Library');
      expect(status).not.toContain('Attachments');
      expect(status).toContain('Wolf.md');
    }
  );

  gitIt('allows licensed text when the mirror folder and its trash are ignored', async () => {
    git(vault, 'init', '-q');
    await write('.gitignore', 'Campaigns/*/AI Tool/\n.trash/\n', vault);
    const result = await new LicensedGuard(campaign, runGit).check();
    expect(result).toMatchObject({ ok: true, licensedOk: true, trashOk: true });
    await write('AI Tool/Foundry/NPCs/Wolf.md', 'a note with a stat block\n');
    expect(git(vault, 'status', '--porcelain', '-uall')).not.toContain('AI Tool');
  });

  gitIt('withholds licensed text when the vault trash is not ignored', async () => {
    git(vault, 'init', '-q');
    await write('.gitignore', 'Campaigns/*/AI Tool/\n', vault);
    const result = await new LicensedGuard(campaign, runGit).check();
    expect(result.ok).toBe(true);
    expect(result.licensedOk).toBe(false);
    expect(result.licensedReason).toContain('.trash/Campaigns/test-world/AI Tool/');
    expect(result.trashOk).toBe(false);
  });

  gitIt('withholds licensed text when a file under the mirror folder is tracked', async () => {
    git(vault, 'init', '-q');
    await write('AI Tool/Foundry/NPCs/Wolf.md', 'an old note\n');
    git(vault, 'add', '--', 'Campaigns/test-world/AI Tool/Foundry/NPCs/Wolf.md');
    await write('.gitignore', 'Campaigns/*/AI Tool/\n.trash/\n', vault);
    const result = await new LicensedGuard(campaign, runGit).check();
    expect(result.ok).toBe(true);
    expect(result.licensedOk).toBe(false);
    expect(result.licensedReason).toContain('tracked');
  });

  gitIt('refuses the Library when licensed files are already tracked', async () => {
    git(vault, 'init', '-q');
    await write('AI Tool/Library/Monsters/Snow Weasel.md', 'made-up note\n');
    git(vault, 'add', '-f', '--', 'Campaigns/test-world/AI Tool/Library/Monsters/Snow Weasel.md');
    const result = await new LicensedGuard(campaign, runGit).check();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('already tracked');
  });
});

describe('LicensedGuard failures fail closed', () => {
  it('refuses whenever git says a licensed folder is not ignored', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    const notIgnored: GitRunner = args =>
      Promise.resolve(
        args[0] === 'check-ignore'
          ? { code: 1, stdout: '', stderr: '' }
          : { code: 0, stdout: '', stderr: '' }
      );
    const result = await new LicensedGuard(campaign, notIgnored).check();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('does not ignore');
    expect(result.licensedOk).toBe(false);
  });

  it('git missing: trusts its own ignore file for the Library, withholds world text', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    const missing: GitRunner = () => Promise.resolve({ code: -1, stdout: '', stderr: 'ENOENT' });
    const result = await new LicensedGuard(campaign, missing).check();
    expect(result.ok).toBe(true);
    expect(result.reason).toContain('tracked files could not be checked');
    expect(result.licensedOk).toBe(false);
    expect(result.licensedReason).toContain('git is not installed');
    expect(result.trashOk).toBe(false);
  });

  it("exit 128 (dubious ownership) is reported as such, with git's first line", async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    const refused: GitRunner = () =>
      Promise.resolve({
        code: 128,
        stdout: '',
        stderr: '\nfatal: detected dubious ownership in repository at /x\nTo add an exception...\n',
      });
    const result = await new LicensedGuard(campaign, refused).check();
    expect(result.ok).toBe(false);
    expect(result.licensedOk).toBe(false);
    expect(result.trashOk).toBe(false);
    expect(result.reason).toContain(
      'exit 128: fatal: detected dubious ownership in repository at /x'
    );
    expect(result.reason).not.toContain('To add an exception');
    expect(result.reason).not.toContain('does not ignore');
  });

  it('allows everything when git confirms every folder is ignored and nothing is tracked', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    const fine: GitRunner = () => Promise.resolve({ code: 0, stdout: '', stderr: '' });
    const result = await new LicensedGuard(campaign, fine).check();
    expect(result).toMatchObject({ ok: true, licensedOk: true, trashOk: true });
  });

  it('caches the result for a few minutes, and reset forgets it', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    let calls = 0;
    let now = 0;
    const counting: GitRunner = () => {
      calls += 1;
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const guard = new LicensedGuard(campaign, counting, () => now);
    await guard.check();
    const first = calls;
    await guard.check();
    expect(calls).toBe(first);
    now += 6 * 60_000;
    await guard.check();
    expect(calls).toBeGreaterThan(first);
    const second = calls;
    guard.reset();
    await guard.check();
    expect(calls).toBeGreaterThan(second);
  });
});
