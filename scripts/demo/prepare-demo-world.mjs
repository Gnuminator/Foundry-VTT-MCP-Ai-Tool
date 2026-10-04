#!/usr/bin/env node
// Tidy a freshly copied ai-tool-demo world into the clean state takes start from (I-082).
// Run once after `reset-demo-world.ps1 -Init -Start` (Foundry, bridge and dashboard
// running), look at the world, then save it with `reset-demo-world.ps1 -Snapshot`.
// Safe to run again.
//
//   node scripts/demo/prepare-demo-world.mjs [--as Claude]
//
// What it does, in the running ai-tool-demo world (it refuses any other world):
//   - deletes every chat message and combat, and the journals that live tests leave
//     behind ("AI Tool Roundtrip Test (safe to delete)", "Handouts", "Tarokka reading");
//   - keeps only the users DEMO_USERS names (the GM it joins as is renamed to DEMO_USERS.gm);
//   - turns on "Allow Write Operations" and "AI Tool: Handouts (writes)";
//   - adds invented prep content for the Prep drawer and the handout take: a GM-only
//     "Letters" journal with one letter, a "Next session" journal, one quest (through the
//     bridge's create-quest-journal) and a short recorded play session with one roll.
// Everything it adds is invented for the demo: no book or campaign text.

import { openWindow } from './lib/browser.mjs';
import { callToolApi, setGmActionsApi } from './lib/dashboard.mjs';
import { DEMO_USERS, demoWorld, testEnv } from './lib/env.mjs';
import { closeAllWindows, joinFoundry, unpause } from './lib/foundry.mjs';

// Left behind by live tests in ai-tool-test; "Tarokka reading" holds Curse of Strahd card
// names, which must never reach a video.
const LEFTOVER_JOURNALS = [
  'AI Tool Roundtrip Test (safe to delete)',
  'Handouts',
  'Tarokka reading',
];

// Invented content, safe for public videos.
const LETTER = {
  journal: 'Letters',
  page: 'A Letter from the Mayor',
  html:
    '<p>To the travellers at the inn,</p>' +
    '<p>Wolves have taken three sheep from the east pasture this week, and the shepherd swears ' +
    'one of them walked on its hind legs. The town will pay fifty gold pieces to whoever ends ' +
    'this. Come to the town hall at first light.</p><p>Mayor Hilde Brannock</p>',
};
const NEXT_SESSION = {
  journal: 'Next session',
  page: 'Plan',
  html:
    '<ul><li>The party meets the mayor at the town hall.</li>' +
    '<li>Tracks lead from the pasture to the old mill.</li>' +
    '<li>Ambush at the mill: three wolves and their pack leader.</li></ul>',
};
const QUEST = {
  questTitle: 'The Wolves of the East Pasture',
  questDescription:
    'The mayor offers fifty gold pieces to stop the wolves that keep taking sheep from the east pasture. The tracks lead to the old mill.',
  questType: 'kill',
  difficulty: 'easy',
  location: 'The old mill',
};

const asIndex = process.argv.indexOf('--as');
const joinAs = asIndex > 0 ? process.argv[asIndex + 1] : DEMO_USERS.gm;
const env = testEnv();
const win = await openWindow({ title: 'Demo prepare', url: 'about:blank' });
try {
  await joinFoundry(win.page, { foundryUrl: env.foundryUrl, world: demoWorld(), user: joinAs });
  await closeAllWindows(win.page);
  const report = await win.page.evaluate(
    async ({ world, users, journals, letter, nextSession }) => {
      const g = globalThis.game;
      if (g.world.id !== world) throw new Error(`Joined ${g.world.id}, not ${world}.`);
      if (!g.user.isGM) throw new Error('Join as a Gamemaster.');
      const done = {};
      done.chat = g.messages.size;
      await globalThis.ChatMessage.deleteDocuments(g.messages.map(m => m.id));
      done.combats = g.combats.size;
      await globalThis.Combat.deleteDocuments(g.combats.map(c => c.id));
      const leftover = g.journal.filter(j => journals.includes(j.name));
      done.journalsRemoved = leftover.map(j => j.name);
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
      await g.settings.set('foundry-mcp-bridge', 'feature.handouts.enabled', true);
      // GM-only journals (default ownership None): the letter becomes a handout when revealed.
      for (const j of [letter, nextSession]) {
        if (g.journal.getName(j.journal)) continue;
        await globalThis.JournalEntry.create({
          name: j.journal,
          ownership: { default: 0 },
          pages: [{ name: j.page, type: 'text', text: { content: j.html } }],
        });
      }
      done.users = g.users.map(u => `${u.name} (${u.isGM ? 'GM' : 'player'})`);
      done.scene = g.scenes.active?.name ?? '(none)';
      done.tokens = g.scenes.active?.tokens.map(t => t.name) ?? [];
      return done;
    },
    {
      world: demoWorld(),
      users: DEMO_USERS,
      journals: LEFTOVER_JOURNALS,
      letter: LETTER,
      nextSession: NEXT_SESSION,
    }
  );
  await unpause(win.page);

  // Through the bridge: the quest (a guarded write) and a short recorded session.
  const hasQuest = await win.page.evaluate(
    title => Boolean(globalThis.game.journal.getName(title)),
    QUEST.questTitle
  );
  await setGmActionsApi(env.dashboardUrl, true);
  try {
    if (!hasQuest) await callToolApi(env.dashboardUrl, 'create-quest-journal', QUEST);
    report.quest = QUEST.questTitle;
    await callToolApi(env.dashboardUrl, 'mark-play-session', { action: 'start' });
    await win.page.evaluate(async () => {
      const roll = await new globalThis.Roll('1d20 + 5').evaluate();
      await roll.toMessage({ flavor: 'Perception check at the pasture' });
    });
    await new Promise(r => setTimeout(r, 3000));
    await callToolApi(env.dashboardUrl, 'mark-play-session', { action: 'end' });
    report.playSession = 'recorded (one roll)';
  } finally {
    await setGmActionsApi(env.dashboardUrl, false);
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(
    '\nLook at the world, then save it: pwsh scripts/test-env/reset-demo-world.ps1 -Snapshot'
  );
} catch (err) {
  console.error(String(err.stack || err));
  process.exitCode = 1;
} finally {
  await win.close();
  // Browser handles can outlive the script; exit with the code set above.
  process.exit();
}
