#!/usr/bin/env node
// Tidy a freshly copied ai-tool-demo world into the clean state takes start from (I-082).
// Run once after `reset-demo-world.ps1 -Init -Start`, look at the world, then save it with
// `reset-demo-world.ps1 -Snapshot`. Safe to run again.
//
//   node scripts/demo/prepare-demo-world.mjs [--as Claude]
//
// What it does, in the running ai-tool-demo world (it refuses any other world):
//   - deletes every chat message and combat, and the journals that live tests leave
//     behind ("AI Tool Roundtrip Test (safe to delete)", "Handouts");
//   - keeps only the users DEMO_USERS names (the GM it joins as is renamed to DEMO_USERS.gm);
//   - turns on "Allow Write Operations" (takes plan, apply and undo guarded changes).

import { openWindow } from './lib/browser.mjs';
import { DEMO_USERS, DEMO_WORLD, testEnv } from './lib/env.mjs';
import { closeAllWindows, joinFoundry } from './lib/foundry.mjs';

const LEFTOVER_JOURNALS = ['AI Tool Roundtrip Test (safe to delete)', 'Handouts'];

const asIndex = process.argv.indexOf('--as');
const joinAs = asIndex > 0 ? process.argv[asIndex + 1] : DEMO_USERS.gm;
const env = testEnv();
const win = await openWindow({ title: 'Demo prepare', url: 'about:blank' });
try {
  await joinFoundry(win.page, { foundryUrl: env.foundryUrl, world: DEMO_WORLD, user: joinAs });
  await closeAllWindows(win.page);
  const report = await win.page.evaluate(
    async ({ world, users, journals }) => {
      const g = globalThis.game;
      if (g.world.id !== world) throw new Error(`Joined ${g.world.id}, not ${world}.`);
      if (!g.user.isGM) throw new Error('Join as a Gamemaster.');
      const done = {};
      done.chat = g.messages.size;
      await globalThis.ChatMessage.deleteDocuments(g.messages.map(m => m.id));
      done.combats = g.combats.size;
      await globalThis.Combat.deleteDocuments(g.combats.map(c => c.id));
      const leftover = g.journal.filter(j => journals.includes(j.name));
      done.journals = leftover.map(j => j.name);
      await globalThis.JournalEntry.deleteDocuments(leftover.map(j => j.id));
      if (g.user.name !== users.gm) await g.user.update({ name: users.gm });
      const keep = new Set([
        g.user.id,
        ...g.users.filter(u => u.name === users.player).map(u => u.id),
      ]);
      const extra = g.users.filter(u => !keep.has(u.id));
      done.usersRemoved = extra.map(u => u.name);
      await globalThis.User.deleteDocuments(extra.map(u => u.id));
      await g.settings.set('foundry-mcp-bridge', 'allowWriteOperations', true);
      done.users = g.users.map(u => `${u.name} (${u.isGM ? 'GM' : 'player'})`);
      done.scene = g.scenes.active?.name ?? '(none)';
      done.tokens = g.scenes.active?.tokens.map(t => t.name) ?? [];
      return done;
    },
    { world: DEMO_WORLD, users: DEMO_USERS, journals: LEFTOVER_JOURNALS }
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(
    '\nLook at the world, then save it: pwsh scripts/test-env/reset-demo-world.ps1 -Snapshot'
  );
} finally {
  await win.close();
}
