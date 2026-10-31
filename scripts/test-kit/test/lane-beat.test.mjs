/**
 * scripts/lane-beat.mjs (npm run lane:beat): the `- last seen:` heartbeat under a lane's claim in the
 * vault Backlog. Every run here uses a scratch vault clone of a local bare remote; the real vault is
 * never touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BACKLOG_PATH,
  STEP_MAX,
  claimLane,
  cleanStep,
  main,
  publishBeat,
  setBeat,
  stampOf,
} from '../../lane-beat.mjs';

const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = !hasGit && 'git is missing';

const BACKLOG = (nl = '\n') =>
  [
    '# Backlog',
    '',
    '## S Alpha',
    '- id: alpha',
    '- claimed: lane-x 2026-10-23',
    '- board: T',
    '',
    '## S Beta',
    '- id: beta',
    '- last seen: 2026-10-22 09:00 claimed',
    '- claimed: lane-x 2026-10-23 kind: design server: 8791',
    '',
    '## S Gamma',
    '- id: gamma',
    '- claimed: lane-xy 2026-10-23',
    '- last seen: 2026-10-22 08:00 PR open',
    '',
    '## S Delta',
    '- id: delta',
    '- board: T',
    '',
  ].join(nl);

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function scratch(text = BACKLOG()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-beat-'));
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  const vault = path.join(dir, 'vault');
  git(dir, 'clone', '-q', path.join(dir, 'remote.git'), vault);
  git(vault, 'config', 'user.email', 'test@example.invalid');
  git(vault, 'config', 'user.name', 'test');
  const file = path.join(vault, ...BACKLOG_PATH.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  git(vault, 'add', '.');
  git(vault, 'commit', '-q', '-m', 'init');
  git(vault, 'push', '-q', '-u', 'origin', 'main');
  return { dir, vault, file };
}

const NOW = new Date('2026-10-23T14:40:00Z'); // 16:40 in Copenhagen (CEST)

test('stampOf is Copenhagen time, summer and winter', () => {
  assert.equal(stampOf(NOW), '2026-10-23 16:40');
  assert.equal(stampOf(new Date('2026-12-01T08:05:00Z')), '2026-12-01 09:05');
});

test('claimLane reads the lane name out of a claim value', () => {
  assert.equal(claimLane('lane-x 2026-10-23'), 'lane-x');
  assert.equal(claimLane('board lane 2 2026-10-23 kind: design server: 8791'), 'board lane 2');
  assert.equal(claimLane('lane-x'), 'lane-x');
});

test('cleanStep: one line, at most 60 characters', () => {
  assert.equal(cleanStep('  PR open\n\tnow '), 'PR open now');
  assert.equal(cleanStep('x'.repeat(100)).length, STEP_MAX);
  assert.equal(cleanStep(undefined), '');
});

test('setBeat puts the line under each claim of the lane, replaces an old one wherever it is, and leaves other lanes alone', () => {
  const { text, items } = setBeat(BACKLOG(), 'lane-x', '2026-10-23 16:40', 'PR open');
  assert.equal(items, 2);
  assert.match(
    text,
    /- id: alpha\n- claimed: lane-x 2026-10-23\n- last seen: 2026-10-23 16:40 PR open\n- board: T/
  );
  assert.match(
    text,
    /- id: beta\n- claimed: lane-x 2026-10-23 kind: design server: 8791\n- last seen: 2026-10-23 16:40 PR open\n/
  );
  assert.equal(
    (text.match(/last seen/g) || []).length,
    3,
    'one per claim of lane-x, and gamma (lane-xy) keeps its own'
  );
  assert.match(text, /- claimed: lane-xy 2026-10-23\n- last seen: 2026-10-22 08:00 PR open/);
  assert.doesNotMatch(text, /09:00 claimed/);
  assert.match(text, /## S Delta\n- id: delta\n- board: T\n$/);
});

test('setBeat keeps CRLF and reports 0 for a lane with no claim', () => {
  const crlf = setBeat(BACKLOG('\r\n'), 'lane-x', '2026-10-23 16:40', 'review').text;
  assert.equal(crlf.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF');
  assert.match(crlf, /- claimed: lane-x 2026-10-23\r\n- last seen: 2026-10-23 16:40 review\r\n/);
  const none = setBeat(BACKLOG(), 'nobody', '2026-10-23 16:40', 'review');
  assert.equal(none.items, 0);
  assert.equal(none.text, BACKLOG());
});

test('npm run lane:beat: writes, commits only the Backlog and pushes', { skip }, () => {
  const s = scratch();
  const out = [];
  const code = main(['lane-x', 'PR open', '--vault', s.vault], {
    now: () => NOW,
    log: l => out.push(l),
    err: l => out.push(`ERR ${l}`),
  });
  assert.equal(code, 0, out.join('\n'));
  assert.match(
    out.join('\n'),
    /wrote "- last seen: 2026-10-23 16:40 PR open" under 2 claimed items of lane-x/
  );
  assert.match(
    fs.readFileSync(s.file, 'utf8'),
    /- id: alpha\n- claimed: lane-x 2026-10-23\n- last seen: 2026-10-23 16:40 PR open/
  );
  assert.equal(
    git(s.vault, 'rev-parse', 'HEAD'),
    git(s.vault, 'rev-parse', 'origin/main'),
    'pushed'
  );
  assert.equal(
    git(s.vault, 'log', '-1', '--format=%s'),
    'Lane beat: lane-x, PR open',
    'the subject names the lane'
  );
  assert.equal(git(s.vault, 'show', '--name-only', '--format=', 'HEAD'), BACKLOG_PATH);
  // a second beat replaces the line instead of adding one
  assert.equal(
    main(['lane-x', 'review', '--vault', s.vault], {
      now: () => new Date('2026-10-23T15:00:00Z'),
      log() {},
      err() {},
    }),
    0
  );
  const text = fs.readFileSync(s.file, 'utf8');
  assert.equal((text.match(/- last seen: 2026-10-23 17:00 review/g) || []).length, 2);
  assert.doesNotMatch(text, /16:40 PR open/);
});

test('pulls first, so a Backlog edit pushed meanwhile is kept', { skip }, () => {
  const s = scratch();
  const other = path.join(s.dir, 'other');
  git(s.dir, 'clone', '-q', path.join(s.dir, 'remote.git'), other);
  git(other, 'config', 'user.email', 't@example.invalid');
  git(other, 'config', 'user.name', 't');
  const f = path.join(other, ...BACKLOG_PATH.split('/'));
  fs.appendFileSync(f, '\n## S Epsilon\n- id: epsilon\n- note: planner edit\n');
  git(other, 'commit', '-qam', 'planner edit');
  git(other, 'push', '-q');
  assert.equal(
    main(['lane-x', 'fixes', '--vault', s.vault], { now: () => NOW, log() {}, err() {} }),
    0
  );
  const text = fs.readFileSync(s.file, 'utf8');
  assert.match(text, /planner edit/);
  assert.match(text, /last seen: 2026-10-23 16:40 fixes/);
  assert.equal(git(s.vault, 'rev-parse', 'HEAD'), git(s.vault, 'rev-parse', 'origin/main'));
});

test(
  'a vault problem is a warning and exit 0; a lane with no claim, or no step, is exit 1',
  { skip },
  () => {
    const s = scratch();
    git(s.vault, 'remote', 'set-url', 'origin', path.join(s.dir, 'missing.git'));
    const errs = [];
    assert.equal(
      main(['lane-x', 'PR open', '--vault', s.vault], {
        now: () => NOW,
        log() {},
        err: l => errs.push(l),
      }),
      0
    );
    assert.match(errs.join('\n'), /lane:beat: WARNING: heartbeat not written: vault fetch failed/);
    const bare = path.join(s.dir, 'nothing');
    fs.mkdirSync(bare);
    const e2 = [];
    assert.equal(
      main(['lane-x', 'PR open', '--vault', bare], {
        now: () => NOW,
        log() {},
        err: l => e2.push(l),
      }),
      0
    );
    assert.match(e2.join('\n'), /WARNING: heartbeat not written: no vault checkout/);
    const s2 = scratch();
    const e3 = [];
    assert.equal(
      main(['nobody', 'PR open', '--vault', s2.vault], {
        now: () => NOW,
        log() {},
        err: l => e3.push(l),
      }),
      1
    );
    assert.match(e3.join('\n'), /no `- claimed: nobody \.\.\.` line/);
    assert.equal(
      git(s2.vault, 'rev-parse', 'HEAD'),
      git(s2.vault, 'rev-parse', 'origin/main'),
      'nothing committed'
    );
    assert.equal(main(['lane-x', '--vault', s2.vault], { err() {} }), 1);
    assert.equal(main([], { err() {} }), 1);
  }
);

test('--dry-run prints the line and writes nothing', { skip }, () => {
  const s = scratch();
  const out = [];
  assert.equal(
    main(['lane-x', 'PR open', '--dry-run', '--vault', s.vault], {
      now: () => NOW,
      log: l => out.push(l),
      err() {},
    }),
    0
  );
  assert.match(out[0], /would write "- last seen: 2026-10-23 16:40 PR open" under 2 claimed items/);
  assert.equal(fs.readFileSync(s.file, 'utf8'), BACKLOG());
  assert.equal(git(s.vault, 'status', '--short'), '');
});

test(
  'review of PR 467 H1: a Backlog.md with uncommitted edits is left alone, nothing is committed',
  { skip },
  () => {
    const s = scratch();
    fs.appendFileSync(s.file, '- note: someone is editing\n');
    const head = git(s.vault, 'rev-parse', 'HEAD');
    const errs = [];
    assert.equal(
      main(['lane-x', 'PR open', '--vault', s.vault], {
        now: () => NOW,
        log() {},
        err: l => errs.push(l),
      }),
      0
    );
    assert.match(
      errs.join('\n'),
      /WARNING: heartbeat not written: Backlog.md has uncommitted edits/
    );
    assert.equal(git(s.vault, 'rev-parse', 'HEAD'), head);
    assert.match(fs.readFileSync(s.file, 'utf8'), /someone is editing/, 'their edit is untouched');
    assert.doesNotMatch(fs.readFileSync(s.file, 'utf8'), /last seen: 2026-10-23 16:40/);
  }
);

test(
  'review of PR 467 H2: a failed push leaves no commit behind and the vault is not mid-rebase',
  { skip },
  () => {
    const s = scratch();
    git(s.vault, 'config', 'remote.origin.pushurl', path.join(s.dir, 'missing.git'));
    const head = git(s.vault, 'rev-parse', 'HEAD');
    const errs = [];
    assert.equal(
      main(['lane-x', 'PR open', '--vault', s.vault], {
        now: () => NOW,
        log() {},
        err: l => errs.push(l),
      }),
      0
    );
    assert.match(errs.join('\n'), /WARNING: heartbeat not pushed/);
    assert.equal(git(s.vault, 'rev-parse', 'HEAD'), head, 'no stranded commit');
    assert.equal(git(s.vault, 'status', '--short'), '', 'the vault is clean');
    assert.equal(
      fs.existsSync(path.join(s.vault, '.git', 'rebase-merge')) ||
        fs.existsSync(path.join(s.vault, '.git', 'rebase-apply')),
      false
    );
  }
);

test('review of PR 467 M1: the repeated autumn hour carries its offset, other times do not', () => {
  assert.equal(stampOf(new Date('2026-10-25T00:30:00Z')), '2026-10-25 02:30+02:00');
  assert.equal(stampOf(new Date('2026-10-25T01:30:00Z')), '2026-10-25 02:30+01:00');
  assert.equal(stampOf(new Date('2026-10-25T02:30:00Z')), '2026-10-25 03:30');
  assert.equal(stampOf(new Date('2026-10-24T23:30:00Z')), '2026-10-25 01:30');
});

test('review of PR 467 M2 and L1: a claim outside a ## S|M|L item is not an item; a lane name with regex characters matches literally', () => {
  const text = [
    '# Backlog',
    '- claimed: lane-x 2026-10-23',
    '',
    '# Chapter',
    '- claimed: lane-x 2026-10-23',
    '',
    '## S Real',
    '- id: real',
    '- claimed: lane.x+ 2026-10-23',
    '',
  ].join('\n');
  assert.equal(setBeat(text, 'lane-x', '2026-10-23 16:40', 'a').items, 0);
  assert.equal(setBeat(text, 'lane.x+', '2026-10-23 16:40', 'a').items, 1);
  assert.equal(setBeat(text, 'lane.x', '2026-10-23 16:40', 'a').items, 0);
});

test('publishBeat never throws, even when git does', () => {
  const s = scratch();
  const r = publishBeat({
    vault: s.vault,
    lane: 'lane-x',
    step: 'x',
    now: NOW,
    run: () => {
      throw new Error('boom');
    },
  });
  assert.match(r.warning, /heartbeat not written: boom/);
});
