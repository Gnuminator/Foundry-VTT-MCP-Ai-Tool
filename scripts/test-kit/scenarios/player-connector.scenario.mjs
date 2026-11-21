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
        name => (/** @type {any} */ (globalThis).game.users.getName(name)?.id ?? ''),
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
      await restartDashboard(null, { repoRoot, port });
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

    /** @type {string | null} */
    let journalId = null;
    await t.step('make a GM-only journal with a canary word', async () => {
      journalId = await page.evaluate(async canary => {
        const g = /** @type {any} */ (globalThis);
        const doc = await g.JournalEntry.create({
          name: `${canary} entry`,
          ownership: { default: 0 },
          pages: [
            { name: `${canary} page`, type: 'text', text: { content: `<p>${canary} secret</p>` } },
          ],
        });
        return doc.id;
      }, CANARY);
      t.cleanup(async () => {
        if (!journalId) return;
        await page.evaluate(async id => {
          await /** @type {any} */ (globalThis).game.journal.get(id)?.delete();
        }, journalId);
      });
      return 'journal made (default ownership none)';
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
      const result = r.body?.result;
      return { text: textOf(result), isError: result?.isError === true, rpcError: r.body?.error };
    };

    await t.step('initialize and list the tools', async () => {
      const init = await rpc('initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'kit' } });
      t.check(init.status === 200, `initialize answered ${init.status} (is the connector on?)`);
      const list = await rpc('tools/list');
      const names = (list.body?.result?.tools ?? []).map((/** @type {any} */ x) => x.name);
      for (const n of TOOLS) t.check(names.includes(n), `tools/list lacks ${n}`, { names });
      return `${names.length} tools listed`;
    });

    await t.step('get-player-skill-guide answers with no arguments', async () => {
      const r = await call('get-player-skill-guide');
      t.check(!r.isError && r.text.length > 200, 'the skill guide is empty or an error', r.text.slice(0, 200));
      return `${r.text.length} characters`;
    });

    await t.step('get-my-character returns the kit Player hero', async () => {
      const r = await call('get-my-character');
      t.check(!r.isError, `get-my-character failed: ${r.text.slice(0, 200)}`);
      t.check(r.text.includes(hero.name), `the reply does not name ${hero.name}`, r.text.slice(0, 400));
      for (const o of others) {
        t.check(!r.text.includes(o.name), `the reply names ${o.name}, a hero this player does not own`);
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
      const r = await call('search-books', { query: 'grappling', limit: 3 });
      t.check(!r.isError, `search-books failed: ${r.text.slice(0, 200)}`);
      const data = jsonOf(r.text);
      const results = Array.isArray(data?.results) ? data.results : [];
      t.check(results.length > 0, 'search-books found nothing for "grappling"', r.text.slice(0, 300));
      hit = results[0];
      return `${results.length} hits`;
    });

    await t.step('find-book-entries lists a class and get-book-entry opens it', async () => {
      const found = await call('find-book-entries', { type: 'class', limit: 3 });
      const data = jsonOf(found.text);
      const first = Array.isArray(data?.results) ? data.results[0] : null;
      t.check(first, 'find-book-entries found no class', found.text.slice(0, 300));
      const packId = first.packId ?? hit?.packId;
      const entryId = first.documentId ?? first.entryId ?? first.id ?? hit?.documentId;
      t.check(packId && entryId, 'a find-book-entries result has no packId and entryId', first);
      const entry = await call('get-book-entry', { packId, entryId });
      t.check(!entry.isError && entry.text.length > 20, `get-book-entry failed: ${entry.text.slice(0, 200)}`);
      return `${first.name ?? 'entry'}, ${entry.text.length} characters`;
    });

    await t.step('get-my-handouts and get-my-play-stats answer', async () => {
      const handouts = await call('get-my-handouts');
      t.check(!handouts.isError, `get-my-handouts failed: ${handouts.text.slice(0, 200)}`);
      const stats = await call('get-my-play-stats');
      t.check(!stats.isError, `get-my-play-stats failed: ${stats.text.slice(0, 200)}`);
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
      t.check(!search.text.includes(CANARY), 'search-books returns the GM journal text', search.text.slice(0, 300));
      const find = await call('find-book-entries', { query: CANARY });
      t.check(!find.text.includes(CANARY), 'find-book-entries returns the GM journal', find.text.slice(0, 300));
      const entry = await call('get-book-entry', { packId: 'world', entryId: journalId ?? 'none' });
      t.check(
        entry.isError || !entry.text.includes(CANARY),
        'get-book-entry opens the GM journal',
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
