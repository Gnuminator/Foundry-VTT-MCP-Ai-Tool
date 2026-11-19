// joinGame (lib/gm.mjs) with a stand-in page: the password field is typed only when a password is
// given, and a failure while typing it never carries the password into an error message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinGame } from '../lib/gm.mjs';
import { EnvError } from '../lib/errors.mjs';

const PASSWORD = 'pw-3c9d-SECRET-TEXT';

/** A page that records what the join form got. */
function stubPage({ failPasswordFill = false, nameIsSelect = false } = {}) {
  /** @type {Array<[string, string, string?]>} */
  const calls = [];
  const locator = selector => ({
    waitFor: async () => {},
    evaluate: async () => nameIsSelect,
    selectOption: async opt => {
      calls.push(['select', selector, opt.label]);
    },
    fill: async value => {
      calls.push(['fill', selector, value]);
      if (selector === '#join-password' && failPasswordFill) {
        // what Playwright's own error text looks like: it quotes the value
        throw new Error(`locator.fill: Timeout 30000ms exceeded.\n  - fill("${value}")`);
      }
    },
    click: async () => {
      calls.push(['click', selector]);
    },
  });
  return {
    calls,
    goto: async url => {
      calls.push(['goto', url]);
    },
    locator,
    keyboard: {
      press: async key => {
        calls.push(['press', key]);
      },
    },
    waitForURL: async () => {},
    waitForFunction: async () => {},
  };
}

test('a passwordless join leaves the password field alone', async () => {
  const page = stubPage();
  await joinGame(/** @type {any} */ (page), { foundryUrl: 'http://x:30000', user: 'Kit GM' });
  assert.ok(
    page.calls.some(c => c[0] === 'fill' && c[1] === '#join-username' && c[2] === 'Kit GM')
  );
  assert.equal(page.calls.filter(c => c[1] === '#join-password').length, 0);
  assert.ok(page.calls.some(c => c[0] === 'click' && c[1] === 'button[name="join"]'));
});

test('a name list (Foundry 14.369) is chosen from, not typed into', async () => {
  const page = stubPage({ nameIsSelect: true });
  await joinGame(/** @type {any} */ (page), { foundryUrl: 'http://x:30000', user: 'Kit GM' });
  assert.ok(
    page.calls.some(c => c[0] === 'select' && c[1] === '#join-username' && c[2] === 'Kit GM')
  );
  assert.equal(page.calls.filter(c => c[0] === 'fill').length, 0);
});

test('a given password is typed into the password field, after the name and before the click', async () => {
  const page = stubPage();
  await joinGame(/** @type {any} */ (page), {
    foundryUrl: 'http://x:30000',
    user: 'Kit GM',
    password: PASSWORD,
  });
  const names = page.calls.map(c => `${c[0]} ${c[1]}`);
  assert.deepEqual(
    page.calls.filter(c => c[1] === '#join-password'),
    [['fill', '#join-password', PASSWORD]]
  );
  assert.ok(names.indexOf('fill #join-username') < names.indexOf('fill #join-password'));
  assert.ok(names.indexOf('fill #join-password') < names.indexOf('click button[name="join"]'));
});

test('a failure while typing the password is reported without the password', async () => {
  const page = stubPage({ failPasswordFill: true });
  await assert.rejects(
    joinGame(/** @type {any} */ (page), {
      foundryUrl: 'http://x:30000',
      user: 'Kit GM',
      password: PASSWORD,
    }),
    e => {
      assert.ok(e instanceof EnvError);
      assert.ok(!e.message.includes(PASSWORD), 'not in the message');
      assert.ok(!String(e.stack).includes(PASSWORD), 'not in the stack');
      assert.equal(e.cause, undefined, 'the raw error is not kept as the cause');
      return true;
    }
  );
});
