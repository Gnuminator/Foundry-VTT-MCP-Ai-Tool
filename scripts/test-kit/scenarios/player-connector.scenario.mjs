/**
 * The player connector (`/mcp/player`) through its real HTTP door, as the kit's Player. The test dashboard is
 * restarted with the connector switched on in its local development mode (FOUNDRY_AI_PLAYER_CONNECTOR=on and
 * FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER = the Foundry id of "Kit Player": no login, loopback only), then the
 * scenario speaks MCP to it: initialize, tools/list, and one call to each of the eight tools. It checks:
 *   - own character: the kit's player hero comes back, with its name;
 *   - a level-up answer for that hero;
 *   - one book hit (search-books, find-book-entries, get-book-entry on a real entry);
 *   - the skill guide, handouts and play stats answer;
 *   - another player's actor and a GM-only journal come back empty (never their names or text).
 * The dashboard goes back to its normal mode afterwards; that restart is registered first, so a failed check
 * never leaves the connector on. Needs the Foundry GM page and a built dashboard, so it is skipped against the
 * fake.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restartDashboard, portOfUrl } from '../lib/dashboard-proc.mjs';
import { KIT_PLAYER_USER } from '../lib/contract.mjs';
import { playerHero, builtHeroes } from '../lib/helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CANARY = 'KIT-CANARY-GM-JOURNAL';
const BOOK_WORD = 'wombatgrapple';
const TOOLS = [
  'get-my-character',
  'get-my-level-up-options',
  'search-books',
  'find-book-entries',
  'get-book-entry',
  'get-my-handouts',
  'get-my-play-stats',
  'get-player-skill-guide',
];

/** The text of an MCP tools/call result, and whether it is an error. @param {any} result */
function textOf(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts.map(c => (typeof c?.text === 'string' ? c.text : '')).join('\n');
}

/** @param {string} text */
function jsonOf(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'player-connector',
  title:
    'The player connector: all eight tools through /mcp/player as the kit Player, own character and level-up, a book hit, and nothing of another actor or a GM journal',
  sizes: ['full', 'long'],
  tags: ['player', 'dashboard'],
  needs: ['heroes'],
  tools: [
    'get-my-character',
    'get-my-level-up-options',
    'search-books',
    'find-book-entries',
    'get-book-entry',
    'get-my-handouts',
    'get-my-play-stats',
    'get-player-skill-guide',
  ],
  // Last, like the login split: its dashboard restart clears the dashboard's in-memory state.
  order: 1000,
  timeoutMs: 300000,

  async run(t) {
    if (t.fake || !t.browser || !t.page) {
      await t.step('needs the Foundry GM page and a real dashboard', async () =>
        t.skip('needs the Foundry GM page and a real dashboard (not available against the fake)')
      );
      return;
    }
    const page = t.page;
    const base = t.browser.dashboardUrl;
    const port = portOfUrl(base);
    const hero = playerHero(t.kit);
    const others = builtHeroes(t.kit).filter(h => !h.owner && h.name !== hero.name);

    /** @type {string} */
    let userId = '';
    await t.step('find the Foundry id of the kit Player', async () => {
      userId = await page.evaluate(
        name => /** @type {any} */ (globalThis).game.users.getName(name)?.id ?? '',
        KIT_PLAYER_USER
      );
      t.check(userId, `no Foundry user named "${KIT_PLAYER_USER}" in the kit world`);
      return `${KIT_PLAYER_USER} found`;
    });

    /** @param {string} p */
    const health = p =>
      fetch(base + p, { signal: AbortSignal.timeout(20000) })
        .then(async r => ({ status: r.status, data: await r.json().catch(() => null) }))
        .catch(() => null);

    await t.step('the test dashboard is in the normal mode', async () => {
      const h = await health('/api/health');
      if (!h || h.status !== 200) t.skip('the dashboard does not answer /api/health');
      if (h?.data?.splitEnabled === true) {
        t.skip('the test dashboard runs in split mode; the kit leaves it alone');
      }
      return 'normal mode, restart allowed';
    });

    const gmActionsBefore = (await t.http('/api/tools')).data?.gmActionsEnabled === true;
    let restored = false;
    const restoreNormal = async () => {
      if (restored) return;
      // Back to the normal mode: no connector variable of the operator's shell comes along.
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith('FOUNDRY_AI_PLAYER_CONNECTOR')) delete env[key];
      }
      await restartDashboard(null, { repoRoot, port, env });
      restored = true;
      for (let i = 0; i < 30; i++) {
        const h = await health('/api/health');
        if (h?.data?.controlChannel === 'connected') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (gmActionsBefore) {
        await t.http('/api/control', {
          method: 'POST',
          body: { action: 'set-gm-actions', value: true },
        });
      }
    };
    t.cleanup(restoreNormal);

    // The dnd5e system packs are never readable to a player, so both the book hit and the GM-only journal live
    // in world packs made here (the player gate works on packs): one readable by players, one only for the GM.
    // The clean-up is registered before the pack is made and deletes by name, and a leftover of an earlier
    // failed run is removed first.
    /** @param {string} name @param {string} label @param {{PLAYER: string, ASSISTANT: string}} ownership @param {string} entryName @param {string} text */
    const makePack = (name, label, ownership, entryName, text) => {
      const collection = `world.${name}`;
      const drop = () =>
        page.evaluate(async id => {
          await /** @type {any} */ (globalThis).game.packs.get(id)?.deleteCompendium();
        }, collection);
      t.cleanup(drop);
      return page
        .evaluate(
          async args => {
            const g = /** @type {any} */ (globalThis);
            await g.game.packs.get(args.collection)?.deleteCompendium();
            const pack =
              await g.foundry.documents.collections.CompendiumCollection.createCompendium({
                label: args.label,
                name: args.name,
                type: 'JournalEntry',
                ownership: args.ownership,
              });
            const doc = await g.JournalEntry.create(
              {
                name: args.entryName,
                pages: [
                  { name: `${args.entryName} page`, type: 'text', text: { content: args.text } },
                ],
              },
              { pack: pack.collection }
            );
            return { packId: pack.collection, entryId: doc.id };
          },
          { collection, name, label, ownership, entryName, text }
        )
        .then(r => /** @type {{packId: string, entryId: string}} */ (r));
    };

    /** @type {{packId: string, entryId: string} | null} */
    let secret = null;
    await t.step(
      'make a GM-only journal with a canary word, in a pack players cannot read',
      async () => {
        secret = await makePack(
          'kit-gm-book',
          'Kit GM Book',
          { PLAYER: 'NONE', ASSISTANT: 'OWNER' },
          `${CANARY} entry`,
          `<p>${CANARY} secret</p>`
        );
        return `${secret.packId} made (players: no access)`;
      }
    );

    await t.step('make a small world book the players can read', async () => {
      const book = await makePack(
        'kit-player-book',
        'Kit Player Book',
        { PLAYER: 'OBSERVER', ASSISTANT: 'OWNER' },
        `Kit ${BOOK_WORD} rule`,
        `<p>A ${BOOK_WORD} is a made-up rule for the kit.</p>`
      );
      return `${book.packId} made`;
    });

    await t.step('restart the dashboard with the player connector on', async () => {
      await restartDashboard(null, {
        repoRoot,
        port,
        env: {
          ...process.env,
          FOUNDRY_AI_PLAYER_CONNECTOR: 'on',
          FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER: userId,
        },
      });
      for (let i = 0; i < 40; i++) {
        const h = await health('/api/health');
        if (h?.data?.controlChannel === 'connected') return 'up, bridge linked';
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('the dashboard came back but the bridge link did not');
    });

    let rpcId = 0;
    /** @param {string} method @param {object} [params] */
    const rpc = async (method, params) => {
      const res = await fetch(`${base}/mcp/player`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
        signal: AbortSignal.timeout(70000),
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    };
    /** @param {string} name @param {object} [args] */
    const call = async (name, args = {}) => {
      const r = await rpc('tools/call', { name, arguments: args });
      t.check(r.status === 200, `${name}: /mcp/player answered ${r.status}`);
      t.check(!r.body?.error, `${name}: JSON-RPC error`, r.body?.error);
      const result = r.body?.result;
      return { text: textOf(result), isError: result?.isError === true, rpcError: r.body?.error };
    };

    await t.step('initialize and list the tools', async () => {
      const init = await rpc('initialize', {
        protocolVersion: '2025-03-26',
        clientInfo: { name: 'kit' },
      });
      t.check(init.status === 200, `initialize answered ${init.status} (is the connector on?)`);
      const list = await rpc('tools/list');
      const names = (list.body?.result?.tools ?? []).map((/** @type {any} */ x) => x.name);
      for (const n of TOOLS) t.check(names.includes(n), `tools/list lacks ${n}`, { names });
      return `${names.length} tools listed`;
    });

    await t.step('get-player-skill-guide answers with no arguments', async () => {
      const r = await call('get-player-skill-guide');
      t.check(
        !r.isError && r.text.length > 200,
        'the skill guide is empty or an error',
        r.text.slice(0, 200)
      );
      return `${r.text.length} characters`;
    });

    await t.step('get-my-character returns the kit Player hero', async () => {
      const r = await call('get-my-character');
      t.check(!r.isError, `get-my-character failed: ${r.text.slice(0, 200)}`);
      t.check(
        r.text.includes(hero.name),
        `the reply does not name ${hero.name}`,
        r.text.slice(0, 400)
      );
      for (const o of others) {
        t.check(
          !r.text.includes(o.name),
          `the reply names ${o.name}, a hero this player does not own`
        );
      }
      return `${hero.name}, ${r.text.length} characters`;
    });

    await t.step('get-my-level-up-options answers for the hero', async () => {
      const r = await call('get-my-level-up-options', { name: hero.name });
      t.check(!r.isError, `get-my-level-up-options failed: ${r.text.slice(0, 200)}`);
      t.check(r.text.length > 50, 'the level-up answer is empty', r.text);
      return `${r.text.length} characters`;
    });

    /** @type {{packId?: string, documentId?: string} | null} */
    let hit = null;
    await t.step('search-books finds a rule', async () => {
      const r = await call('search-books', { query: BOOK_WORD, limit: 3 });
      t.check(!r.isError, `search-books failed: ${r.text.slice(0, 200)}`);
      const data = jsonOf(r.text);
      const results = Array.isArray(data?.results) ? data.results : [];
      t.check(
        results.length > 0,
        `search-books found nothing for "${BOOK_WORD}"`,
        r.text.slice(0, 300)
      );
      hit = results[0];
      return `${results.length} hits`;
    });

    await t.step('find-book-entries lists the entry and get-book-entry opens it', async () => {
      const found = await call('find-book-entries', { query: BOOK_WORD, limit: 3 });
      t.check(!found.isError, `find-book-entries failed: ${found.text.slice(0, 200)}`);
      const data = jsonOf(found.text);
      const first = Array.isArray(data?.results) ? data.results[0] : null;
      t.check(
        first,
        `find-book-entries found nothing for "${BOOK_WORD}"`,
        found.text.slice(0, 300)
      );
      const packId = first.packId ?? hit?.packId;
      const entryId = first.documentId ?? first.entryId ?? first.id ?? hit?.documentId;
      t.check(packId && entryId, 'a result has no packId and entryId', first);
      const entry = await call('get-book-entry', { packId, entryId });
      t.check(
        !entry.isError && entry.text.includes(BOOK_WORD),
        `get-book-entry failed: ${entry.text.slice(0, 200)}`
      );
      return `${first.name ?? 'entry'}, ${entry.text.length} characters`;
    });

    await t.step('get-my-handouts and get-my-play-stats answer', async () => {
      const handouts = await call('get-my-handouts');
      t.check(
        !handouts.isError && handouts.text.length > 0,
        `get-my-handouts failed: ${handouts.text.slice(0, 200)}`
      );
      const stats = await call('get-my-play-stats');
      t.check(
        !stats.isError && stats.text.length > 0,
        `get-my-play-stats failed: ${stats.text.slice(0, 200)}`
      );
      return 'both answered';
    });

    await t.step("another player's actor comes back empty", async () => {
      const other = others[0];
      if (!other) t.skip('the kit has no second hero to ask for');
      for (const tool of ['get-my-character', 'get-my-level-up-options']) {
        const r = await call(tool, { name: other.name });
        t.check(!r.text.includes(other.actorId), `${tool} leaks the actor id of ${other.name}`);
        const data = jsonOf(r.text);
        const sheet = JSON.stringify(data ?? r.text);
        // An error or an empty answer is fine; the hero's own sheet data is not.
        t.check(
          r.isError || !sheet.includes(other.name),
          `${tool} returned ${other.name}, a hero this player does not own`,
          r.text.slice(0, 300)
        );
      }
      return `${other.name} refused`;
    });

    await t.step('a GM-only journal comes back empty', async () => {
      const search = await call('search-books', { query: CANARY });
      // The reply echoes the query, so only the results are judged.
      const found = jsonOf(search.text)?.results;
      t.check(
        Array.isArray(found) && found.length === 0,
        'search-books returns the GM journal',
        search.text.slice(0, 300)
      );
      const find = await call('find-book-entries', { query: CANARY });
      const listed = jsonOf(find.text)?.results;
      t.check(
        Array.isArray(listed) && listed.length === 0,
        'find-book-entries returns the GM journal',
        find.text.slice(0, 300)
      );
      // The real pack and entry ids: the entry exists, so only the player gate can refuse it.
      t.check(secret, 'the GM-only pack was not made');
      const entry = await call('get-book-entry', secret);
      t.check(
        entry.isError && !entry.text.includes(CANARY),
        'get-book-entry opens the GM journal (or answers without refusing)',
        entry.text.slice(0, 300)
      );
      return 'no trace of the canary';
    });

    await t.step('put the dashboard back in its normal mode', async () => {
      await restoreNormal();
      const r = await fetch(`${base}/mcp/player`, { method: 'POST', body: '{}' }).catch(() => null);
      t.check(!r || r.status !== 200, 'the connector still answers after the restart back');
      return 'normal mode again';
    });
  },
};
