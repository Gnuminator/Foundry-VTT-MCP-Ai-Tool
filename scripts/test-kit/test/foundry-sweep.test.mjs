/**
 * The row runner and the dialog helpers of the Foundry control sweep (lib/foundry-sweep.mjs), against
 * fake pages: how a row judges the console errors of both pages, what a skipped row leaves for the
 * stray-error check, and which dialog button the sweep may click.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  Skip,
  Sweep,
  answerNo,
  answerYes,
  escapeRegExp,
  runAll,
} from '../lib/foundry-sweep.mjs';

/** A page that only has the console events and the waits a row uses. */
function fakePage() {
  const page = new EventEmitter();
  /** @param {string} text */
  page.logError = text => page.emit('console', { type: () => 'error', text: () => text });
  page.waitForTimeout = async () => {};
  page.evaluate = async () => undefined;
  return page;
}

function sweepOf() {
  const gm = fakePage();
  const player = fakePage();
  return { gm, player, sweep: new Sweep({ gm, player }) };
}

test('a row with no console error passes and keeps its note', async () => {
  const { sweep } = sweepOf();
  const r = await sweep.row('a', 'gm', async () => 'fine');
  assert.equal(r.status, 'pass');
  assert.equal(r.note, 'fine');
  assert.deepEqual(sweep.strayErrors(), []);
});

test('a console error on the other page during a row fails it and names that page', async () => {
  const { sweep, player } = sweepOf();
  const r = await sweep.row('a', 'gm', async () => {
    player.logError('boom');
  });
  assert.equal(r.status, 'fail');
  assert.match(r.note, /console error on the player page: boom/);
  assert.deepEqual(sweep.strayErrors(), []);
});

test('expectErrors excuses its own text and nothing else', async () => {
  const { sweep, gm } = sweepOf();
  const r = await sweep.row(
    'a',
    'gm',
    async () => {
      gm.logError('Write the text first');
      gm.logError('something else');
    },
    { expectErrors: [/Write the text/] }
  );
  assert.equal(r.status, 'fail');
  assert.match(r.note, /something else/);
  assert.doesNotMatch(r.note, /Write the text/);
});

test('a thrown Skip is a skip, and the errors it saw stay for the stray check', async () => {
  const { sweep, gm } = sweepOf();
  const r = await sweep.row('a', 'gm', async () => {
    gm.logError('late and unexpected');
    throw new Skip('not in this world');
  });
  assert.equal(r.status, 'skip');
  assert.equal(r.note, 'not in this world');
  assert.equal(sweep.strayErrors().length, 1);
  assert.match(sweep.strayErrors()[0], /gm page, outside a row: late and unexpected/);
});

test('a skipped row whose errors are all announced leaves nothing behind', async () => {
  const { sweep, gm } = sweepOf();
  await sweep.row(
    'a',
    'gm',
    async () => {
      gm.logError('announced');
      throw new Skip('why');
    },
    { expectErrors: [/announced/] }
  );
  assert.deepEqual(sweep.strayErrors(), []);
});

test('an error outside every row is stray, also when its text matches a pattern some row announced', async () => {
  const { sweep, gm } = sweepOf();
  gm.logError('setup noise');
  await sweep.row('a', 'gm', async () => {}, { expectErrors: [/announced/] });
  // The same text as the announced one, but long after that row ended.
  gm.logError('announced');
  sweep.watch.gm.times[sweep.watch.gm.times.length - 1] += 60000;
  const stray = sweep.strayErrors();
  assert.equal(stray.length, 2);
  assert.match(stray[0], /setup noise/);
  assert.match(stray[1], /announced/);
});

test('a failed row closes the dialogs of both pages', async () => {
  const { sweep, gm, player } = sweepOf();
  let closed = 0;
  gm.evaluate = async () => void closed++;
  player.evaluate = async () => void closed++;
  await sweep.row('a', 'gm', async () => {
    throw new Error('no');
  });
  assert.equal(closed, 2);
});

test('runAll runs every step and throws one error listing the failures', async () => {
  const ran = [];
  await assert.rejects(
    runAll([
      [
        'one',
        async () => {
          ran.push(1);
          throw new Error('x');
        },
      ],
      ['two', async () => void ran.push(2)],
      [
        'three',
        async () => {
          throw new Error('y');
        },
      ],
    ]),
    /one: x \| three: y/
  );
  assert.deepEqual(ran, [1, 2]);
});

test('escapeRegExp makes a literal pattern of any text', () => {
  const text = 'a.b*c? (d) [e] {f} ^g$ h|i \\j';
  assert.ok(new RegExp(escapeRegExp(text)).test(text));
  assert.ok(!new RegExp(escapeRegExp('a.b')).test('axb'));
});

/** A page with one open dialog: its title and buttons, and a record of the clicks. */
function dialogPage(title, buttons) {
  const clicked = [];
  const dialog = {
    last: () => dialog,
    waitFor: async () => {},
    evaluate: async () => ({
      title,
      buttons,
      actions: buttons.map(b => b.action).filter(Boolean),
      labels: buttons.map(b => b.label),
      text: '',
    }),
    locator: selector => ({
      first: () => ({ click: async () => void clicked.push(selector) }),
    }),
  };
  return { page: { locator: () => dialog }, clicked };
}

test('answerYes clicks the yes action, or the button the caller named', async () => {
  const yes = dialogPage('Undo', [
    { action: 'cancel', label: 'Cancel' },
    { action: 'yes', label: 'Undo change' },
  ]);
  assert.equal(await answerYes(yes.page), 'yes');
  assert.deepEqual(yes.clicked, ['button[data-action="yes"]']);

  const named = dialogPage('Undo', [
    { action: 'just-this', label: 'Just this' },
    { action: 'cancel', label: 'Cancel' },
  ]);
  assert.equal(await answerYes(named.page, 'just this'), 'just-this');
});

test('answerYes refuses a dialog with no yes, and never answers the rewind dialog', async () => {
  const other = dialogPage('Something', [
    { action: 'cancel', label: 'Cancel' },
    { action: 'wipe', label: 'Wipe everything' },
  ]);
  await assert.rejects(answerYes(other.page, 'Undo'), /has no yes button/);
  assert.deepEqual(other.clicked, []);

  const rewind = dialogPage('Rewind the whole table', [{ action: 'yes', label: 'Rewind' }]);
  await assert.rejects(answerYes(rewind.page), /does not answer/);
  assert.deepEqual(rewind.clicked, []);
});

test('answerNo takes cancel or no and throws without either', async () => {
  const withNo = dialogPage('Reveal', [
    { action: 'yes', label: 'Reveal' },
    { action: 'no', label: 'No' },
  ]);
  assert.equal(await answerNo(withNo.page), 'no');
  const none = dialogPage('Reveal', [{ action: 'yes', label: 'Reveal' }]);
  await assert.rejects(answerNo(none.page), /has no Cancel/);
});
