import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findTags,
  listPrepNames,
  makeTitle,
  memoDate,
  processInbox,
  safeFileTitle,
  transcriptText,
} from './voice-memos-lib.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'voice-memos-'));
  const vault = join(root, 'vault');
  const memos = join(root, 'memos');
  mkdirSync(join(vault, 'Prep', 'NPCs'), { recursive: true });
  mkdirSync(join(vault, 'Prep', 'Templates'), { recursive: true });
  writeFileSync(join(vault, 'Prep', 'NPCs', 'Ismark.md'), '');
  writeFileSync(join(vault, 'Prep', 'NPCs', 'Ireena Kolyana.md'), '');
  writeFileSync(join(vault, 'Prep', 'Templates', 'NPC.md'), '');
  mkdirSync(join(memos, 'inbox'), { recursive: true });
  return { root, vault, memos };
}

test('transcriptText joins the segments', () => {
  assert.equal(
    transcriptText({ segments: [{ text: ' Hej ' }, { text: 'du.' }, { text: '' }] }),
    'Hej du.'
  );
  assert.equal(transcriptText({}), '');
});

test('makeTitle takes the first sentence and cuts long ones at a word', () => {
  assert.equal(makeTitle('Ismark skal lyve om det. Og mere.'), 'Ismark skal lyve om det');
  assert.equal(makeTitle(''), 'Voice memo');
  const t = makeTitle('ord '.repeat(40));
  assert.ok(t.length <= 64 && t.endsWith('...'));
});

test('safeFileTitle drops characters Windows and Obsidian refuse', () => {
  assert.equal(safeFileTitle('Hvad? A/B: "x" #1'), 'Hvad A B x 1');
});

test('listPrepNames reads Prep note names and skips templates', () => {
  const { vault } = setup();
  assert.deepEqual(
    listPrepNames(vault)
      .map(n => n.name)
      .sort(),
    ['Ireena Kolyana', 'Ismark']
  );
});

test('findTags matches whole words, ignoring case, and longest names first', () => {
  const names = [{ name: 'Ismark' }, { name: 'Ireena Kolyana' }, { name: 'Ann' }];
  const hits = findTags('ismark og ireena kolyana, Annabel snakker', names).map(n => n.name);
  assert.deepEqual(hits, ['Ireena Kolyana', 'Ismark']);
  assert.deepEqual(findTags('Ismarks hest', names), []);
});

test('memoDate reads the file name prefix', () => {
  assert.equal(memoDate('2026-11-26_1405-99.ogg', new Date(0)).getHours(), 14);
  const fb = new Date(5);
  assert.equal(memoDate('mine.ogg', fb), fb);
});

test('processInbox writes a dated, tagged note and moves the audio to done', async () => {
  const { vault, memos } = setup();
  writeFileSync(join(memos, 'inbox', '2026-11-26_1405-1.ogg'), 'x');
  let seen;
  const results = await processInbox({
    memosDir: memos,
    vaultDir: vault,
    transcribe: async dir => {
      seen = readdirSync(dir).sort();
      return { memo1: 'Ismark skal lyve om det. Ireena Kolyana ved det ikke.' };
    },
  });
  assert.deepEqual(seen, ['memo1.ogg', 'names.txt']);
  assert.equal(results.length, 1);
  assert.ok(results[0].ok);
  assert.deepEqual(results[0].tags, ['Ireena Kolyana', 'Ismark']);
  const note = readFileSync(results[0].note, 'utf8');
  assert.match(results[0].note, /Voice memos[\\/]2026-11-26 1405 Ismark skal lyve om det\.md$/);
  assert.match(note, /^---\ntype: voice-memo\nstatus: new\ndate: 2026-11-26\n/);
  assert.match(note, /ai_context: true/);
  assert.match(note, /tags: \[voice-memo, ireena-kolyana, ismark\]/);
  assert.match(note, /Mentions: \[\[Ireena Kolyana\]\], \[\[Ismark\]\]/);
  assert.ok(existsSync(join(memos, 'done', '2026-11-26_1405-1.ogg')));
  assert.ok(!existsSync(join(memos, 'inbox', '2026-11-26_1405-1.ogg')));
  assert.ok(!existsSync(join(memos, 'work')));
});

test('a silent memo and a transcriber failure stay in the inbox', async () => {
  const { vault, memos } = setup();
  writeFileSync(join(memos, 'inbox', 'a.ogg'), 'x');
  const silent = await processInbox({
    memosDir: memos,
    vaultDir: vault,
    transcribe: async () => ({ memo1: '  ' }),
  });
  assert.equal(silent[0].ok, false);
  assert.match(silent[0].error, /nothing was heard/);
  const failed = await processInbox({
    memosDir: memos,
    vaultDir: vault,
    transcribe: async () => {
      throw new Error('GPU busy');
    },
  });
  assert.equal(failed[0].ok, false);
  assert.equal(failed[0].error, 'GPU busy');
  assert.ok(existsSync(join(memos, 'inbox', 'a.ogg')));
});

test('an empty inbox is not an error and does not call the transcriber', async () => {
  const { vault, memos } = setup();
  const r = await processInbox({
    memosDir: memos,
    vaultDir: vault,
    transcribe: async () => {
      throw new Error('should not run');
    },
  });
  assert.deepEqual(r, []);
});
