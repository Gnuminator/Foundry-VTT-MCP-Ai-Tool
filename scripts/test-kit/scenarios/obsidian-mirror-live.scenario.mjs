/**
 * The Obsidian mirror on a real server: the mirror is switched on for the kit world through the
 * guarded plan, one reconcile runs, the notes land in the TEST vault (never the GM's own vault),
 * a note the "GM" edited is left alone, and the note of a deleted actor moves to the vault `.trash`.
 *
 * Needs a real run (the fake has no vault): the bridge must run with FOUNDRY_AI_OBSIDIAN_DIR set to
 * the test environment's vault (C:\FoundryTest\obsidian on server A), which scripts/test-env/start.ps1
 * does. This scenario reads the same folder: env FOUNDRY_AI_OBSIDIAN_DIR, else the default below.
 * The scenario refuses a vault folder that is not under a test-environment root.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_TEST_VAULT = 'C:\\FoundryTest\\obsidian';
const PC_NAME = 'Mirror Check PC';
const NPC_NAME = 'Mirror Check NPC';
const RENAMED_PC = 'Mirror Check PC Renamed';
const EDIT_MARK = 'EDITED BY THE KIT: leave this line alone.';
const WAIT_MS = 90_000;

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Markdown files under a folder, subfolders included (notes sit in their Foundry folder's path);
 * empty when it does not exist.
 * @param {string} dir @returns {string[]}
 */
function notesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? notesIn(path.join(dir, e.name))
      : e.name.endsWith('.md')
        ? [path.join(dir, e.name)]
        : []
  );
}

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'obsidian-mirror-live',
  title:
    'The Obsidian mirror writes notes to the test vault, leaves an edited note alone and trashes a deleted actor’s note',
  sizes: ['full'],
  tags: ['bridge', 'module'],
  needs: [],
  tools: ['get-obsidian-mirror', 'plan-obsidian-mirror', 'apply-planned-change', 'undo-change'],
  gmActions: ['createFixtureActors', 'adoptActor', 'deleteKitActor', 'setFeatureSwitches'],
  timeoutMs: 480_000,
  order: 5,

  async run(t) {
    if (t.fake) t.skip('needs a real server and the test vault (the fake has no vault)');

    const vaultDir = path.resolve(process.env.FOUNDRY_AI_OBSIDIAN_DIR || DEFAULT_TEST_VAULT);
    await t.step('the vault folder is the test vault, not the GM vault', async () => {
      // Only a vault inside a test server's root (C:\FoundryTest, ...B, ...C). The bridge's own
      // folder is not readable, so the run also fails (writing nothing more) if no note shows up here.
      t.check(
        /^[a-z]:\\foundrytest[abc]?\\/i.test(`${vaultDir}\\`),
        `the mirror vault ${vaultDir} is not a test-environment folder; set FOUNDRY_AI_OBSIDIAN_DIR to the test vault`
      );
      t.check(existsSync(vaultDir), `the test vault folder exists: ${vaultDir}`);
      return vaultDir;
    });

    const read = async () => (await t.tool('get-obsidian-mirror', {})) ?? {};
    /** Polls the mirror view until `fn` returns something truthy. @param {string} what @param {(view: any) => unknown} fn */
    const waitFor = async (what, fn) => {
      const until = Date.now() + WAIT_MS;
      let last;
      for (;;) {
        last = await read();
        const hit = await fn(last);
        if (hit) return { view: last, hit };
        if (Date.now() > until) {
          t.check(false, `timed out after ${WAIT_MS / 1000}s waiting for ${what}`, last?.status);
        }
        await sleep(2000);
      }
    };

    /** @type {any} */
    let first = await read();
    t.check(first.vaultDirSet === true, 'the bridge runs with FOUNDRY_AI_OBSIDIAN_DIR set', first);

    /** @type {string[]} */
    const actorIds = [];
    t.cleanup(async () => {
      for (const actorId of actorIds) {
        try {
          await t.gm('deleteKitActor', { actorId });
        } catch {
          /* already gone */
        }
      }
    });

    await t.step('two kit actors exist (a character and an npc)', async () => {
      const made = await t.gm('createFixtureActors', {
        names: [PC_NAME, NPC_NAME],
        folderId: t.kit?.folders?.Actor,
      });
      actorIds.push(...made.actorIds);
      t.equal(made.actorIds.length, 2, 'actor count');
    });

    // Notes of an earlier run of this scenario (its own test data) would hide what this run checks.
    await t.step('notes left by an earlier run are removed from the test vault', async () => {
      const worldId = first.status?.worldId ?? t.kit?.world;
      let removed = 0;
      if (worldId) {
        for (const root of [
          path.join(vaultDir, 'Campaigns', String(worldId), 'AI Tool', 'Foundry'),
          path.join(vaultDir, '.trash', 'Campaigns', String(worldId), 'AI Tool', 'Foundry'),
        ]) {
          for (const file of notesIn(root)) {
            if (/^Mirror Check (PC|NPC)/.test(path.basename(file))) {
              rmSync(file);
              removed++;
            }
          }
        }
      }
      return `${removed} removed`;
    });

    const startedAt = new Date().toISOString();
    const wasOn = first.settings?.enabled === true;
    await t.step('the mirror is switched on through the guarded plan', async () => {
      const tools = await t.http('/api/tools');
      if (!(tools.status === 200 && tools.data?.gmActionsEnabled === true)) {
        t.cleanup(async () => {
          await t.http('/api/control', {
            method: 'POST',
            body: { action: 'set-gm-actions', value: false },
          });
        });
        await t.http('/api/control', {
          method: 'POST',
          body: { action: 'set-gm-actions', value: true },
        });
      }
      const { before } = await t.gm('setFeatureSwitches', {
        switches: { 'obsidian-mirror': true },
      });
      t.cleanup(async () => {
        await t.gm('setFeatureSwitches', { switches: before });
      });
      if (wasOn) return 'already on';
      const applied = await t.guarded.planApply('plan-obsidian-mirror', { enabled: true });
      t.cleanup(async () => {
        await t.guarded.undo(applied.changeId);
      });
      return applied.plan?.summary ?? 'applied';
    });

    /** @type {any} */
    let status;
    await t.step('one reconcile runs and the notes of both actors appear', async () => {
      const { view } = await waitFor('a reconcile and both notes', v => {
        const s = v.status;
        if (!s || !s.lastReconcileAt) return false;
        if (!wasOn && s.lastReconcileAt < startedAt) return false;
        const folder = path.join(vaultDir, 'Campaigns', String(s.worldId), 'AI Tool', 'Foundry');
        return (
          notesIn(folder).some(f => path.basename(f).startsWith(PC_NAME)) &&
          notesIn(folder).some(f => path.basename(f).startsWith(NPC_NAME))
        );
      });
      status = view.status;
      return `reconciled ${status.lastReconcileAt}`;
    });

    const world = String(status.worldId);
    const folder = path.join(vaultDir, 'Campaigns', world, 'AI Tool', 'Foundry');
    const findNote = (/** @type {string} */ prefix) =>
      notesIn(folder).find(f => path.basename(f).startsWith(prefix));

    await t.step('note counts are above zero, with no errors and nothing skipped', async () => {
      const total = Object.values(status.counts ?? {}).reduce((a, b) => a + Number(b), 0);
      t.check(total > 0, 'the status counts managed notes', status.counts);
      t.equal(status.errors, [], 'mirror errors');
      t.equal(status.skipped, [], 'skipped notes before any edit');
      return `${total} notes`;
    });

    const pcNote = findNote(PC_NAME);
    const npcNote = findNote(NPC_NAME);
    t.check(pcNote && npcNote, 'both note files were found', { pcNote, npcNote });

    await t.step('an edited note is left alone when its actor changes', async () => {
      const file = /** @type {string} */ (pcNote);
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n${EDIT_MARK}\n`);
      await t.gm('adoptActor', { actorId: actorIds[0], name: RENAMED_PC });
      const { view } = await waitFor('the edited note to be listed as skipped', v =>
        (v.status?.skipped ?? []).some((/** @type {any} */ s) => String(s.path).includes(PC_NAME))
      );
      const text = readFileSync(file, 'utf8');
      t.check(text.includes(EDIT_MARK), 'the edit is still in the file');
      t.check(!text.includes(RENAMED_PC), 'the note was not rewritten with the new name');
      return `skipped: ${view.status.skipped[0].reason}`;
    });

    await t.step('a deleted actor’s note moves to the vault .trash', async () => {
      await t.gm('deleteKitActor', { actorId: actorIds[1] });
      // Deleted notes are moved by a reconcile, which otherwise runs every 10 minutes. A settings
      // change makes one due (the mirror's settings hash changes); an excluded folder id that
      // matches nothing changes the hash and nothing else. The reconcile is throttled to 1 a minute.
      const nudge = await t.guarded.planApply('plan-obsidian-mirror', {
        excludeFolderIds: ['KitMirrorNudge01'],
      });
      t.cleanup(async () => {
        await t.guarded.undo(nudge.changeId);
      });
      const trashDir = path.join(vaultDir, '.trash', 'Campaigns', world, 'AI Tool', 'Foundry');
      const until = Date.now() + 2 * WAIT_MS;
      while (
        existsSync(/** @type {string} */ (npcNote)) ||
        !notesIn(trashDir).some(f => path.basename(f).startsWith(NPC_NAME))
      ) {
        if (Date.now() > until) {
          t.check(false, 'the NPC note did not reach .trash in time', {
            stillThere: existsSync(/** @type {string} */ (npcNote)),
            trash: notesIn(trashDir),
          });
        }
        await sleep(2000);
      }
      t.check(
        notesIn(trashDir).some(f => path.basename(f).startsWith(NPC_NAME)),
        'the NPC note is in .trash'
      );
    });
  },
};
