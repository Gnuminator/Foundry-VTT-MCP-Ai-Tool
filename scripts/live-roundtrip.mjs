/**
 * Scripted live round trip of a guarded write (PB-24). Talks ONLY to the local TEST
 * dashboard (http://127.0.0.1:3100, see scripts/test-env) and refuses every other port,
 * in particular the live bridge ports 31414-31416. Run it before merging anything that
 * touches the Foundry link or guarded writes.
 *
 *   node scripts/live-roundtrip.mjs            (or: npm run live:roundtrip)
 *   node scripts/live-roundtrip.mjs --help
 *
 * Needs the test environment running: `pwsh scripts/test-env/start.ps1`, then a GM
 * client joined to the world `ai-tool-test` (the passwordless "Claude" user) so the
 * bridge has a Foundry link. The script says so and exits with 2 when it cannot reach it.
 *
 * What it does (one pass/fail line per step; exit code 0 only when every step passed):
 *   1. dashboard reachable and its control channel to the test bridge connected
 *   2. Foundry live: get-world-info answers and the world is `ai-tool-test`
 *   3. GM Actions switched on (its previous state is restored at the end)
 *   4. set up: a small test journal with one text page "Roundtrip Handout" (created once
 *      with create-quest-journal, reused by every later run; nothing to clean up)
 *   5. plan: plan-page-reveal (reveal, copy: true) of that page
 *   6. confirm: apply-planned-change (destructive class, so both confirmations)
 *   7. verify: list-revealed-pages shows the copy in "Handouts", get-player-handouts has it
 *   8. undo: list-recent-changes, undo-change
 *   9. verify gone: the copy is no longer listed or handed to players
 *  10. clean up: GM Actions back to its previous state; if a step failed after the apply,
 *      the change is undone anyway so the world is left as it was
 *
 * One-time manual setup (cannot be done through the tool API):
 *   - In the test world (Foundry), Settings > Game Settings > category "Foundry AI Tool":
 *     switch on "AI Tool: Handouts (writes)" (and keep "Allow Write Operations" on, the
 *     default). Without it step 6 fails with 'The "handouts" feature is switched off' and the
 *     script exits with 2. A reveal also creates the player journal "Handouts" on first use
 *     and leaves it in place (empty after the undo); that is harmless.
 *   - The test journal "AI Tool Roundtrip Test (safe to delete)" stays in the test world
 *     between runs on purpose. Delete it by hand in Foundry whenever you like; the next run
 *     creates it again.
 *
 * Environment: COGM_BASE (default http://127.0.0.1:3100; only port 3100 on this machine is
 * accepted), COGM_TOKEN (GM token, only when the test dashboard was started with the
 * player/GM split on).
 *
 * Exit codes: 0 all steps passed, 1 a step failed, 2 environment not running or not set up.
 */

const TEST_DASHBOARD_PORT = 3100;
const EXPECTED_WORLD = 'ai-tool-test';
const LIVE_BRIDGE_PORTS = [31414, 31415, 31416];
const JOURNAL_NAME = 'AI Tool Roundtrip Test (safe to delete)';
const PAGE_NAME = 'Roundtrip Handout';

const EXIT_FAIL = 1;
const EXIT_ENV = 2;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`live-roundtrip: plan -> confirm -> verify -> undo -> verify gone, on the TEST world.

Usage: node scripts/live-roundtrip.mjs [--help]

Only talks to the test dashboard on 127.0.0.1:${TEST_DASHBOARD_PORT} (COGM_BASE may name
localhost, 127.0.0.1 or [::1], but only port ${TEST_DASHBOARD_PORT}). Never the live bridge (31414-31416).
Start the test environment first: pwsh scripts/test-env/start.ps1 (see the foundry-test-env skill).
One-time setup: switch on "AI Tool: Handouts (writes)" in the test world's module settings.

Exit codes: 0 all steps passed, 1 a step failed, 2 environment not running or not set up.
Read the header of this file for the full step list.`);
  process.exit(0);
}

// --- Port guard -------------------------------------------------------------

function resolveBase() {
  const raw = process.env.COGM_BASE || `http://127.0.0.1:${TEST_DASHBOARD_PORT}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`REFUSED: COGM_BASE "${raw}" is not a URL.`);
    process.exit(EXIT_ENV);
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (LIVE_BRIDGE_PORTS.includes(port)) {
    console.error(
      `REFUSED: port ${port} is the live bridge. This script only uses the test dashboard.`
    );
    process.exit(EXIT_ENV);
  }
  if (!localHost || port !== TEST_DASHBOARD_PORT) {
    console.error(
      `REFUSED: ${url.host} is not the test dashboard. Only 127.0.0.1:${TEST_DASHBOARD_PORT} (or localhost) is allowed.`
    );
    process.exit(EXIT_ENV);
  }
  // 127.0.0.1 rather than localhost: localhost tries IPv6 first and is slow on Windows.
  return `http://${url.hostname === 'localhost' ? '127.0.0.1' : url.hostname}:${port}`;
}

const BASE = resolveBase();
const TOKEN = process.env.COGM_TOKEN || '';

// --- HTTP helpers -----------------------------------------------------------

class EnvError extends Error {}

async function http(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(TOKEN ? { 'X-CoGM-Token': TOKEN } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const code = e && e.cause && e.cause.code;
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new EnvError(`nothing is listening on ${BASE}`);
    }
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, data };
}

/** Calls a bridge tool through the dashboard. Throws Error with the tool's message on failure. */
async function tool(name, args = {}, flags = {}) {
  const { status, data } = await http('/api/tool', {
    method: 'POST',
    body: { name, args, ...flags },
    timeoutMs: 70000,
  });
  if (status === 403 && data && data.code === 'gm-required') {
    throw new EnvError('the dashboard needs the GM token (set COGM_TOKEN)');
  }
  if (!data || data.ok !== true) {
    const why = (data && (data.error || data.code)) || `HTTP ${status}`;
    throw new Error(`${name}: ${String(why).replace(/\s+/g, ' ')}`);
  }
  return data.result;
}

// --- Step runner ------------------------------------------------------------

let failed = 0;
let stepNo = 0;

async function step(label, fn) {
  stepNo += 1;
  const tag = `[${String(stepNo).padStart(2, '0')}]`;
  try {
    const detail = await fn();
    console.log(`PASS ${tag} ${label}${detail ? `: ${detail}` : ''}`);
    return { ok: true, value: detail };
  } catch (e) {
    if (e instanceof EnvError) throw e;
    failed += 1;
    console.log(`FAIL ${tag} ${label}: ${e && e.message ? e.message : e}`);
    return { ok: false, error: e };
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// --- The round trip ---------------------------------------------------------

let gmActionsBefore = null;
let appliedChangeId = null; // set while a change is applied and not yet undone
let pageUuid = null;

async function setGmActions(value) {
  const { status, data } = await http('/api/control', {
    method: 'POST',
    body: { action: 'set-gm-actions', value },
  });
  assert(status === 200, `/api/control answered HTTP ${status}`);
  return data;
}

async function findJournal() {
  const listed = await tool('list-journals', {});
  return (listed.journals || []).find(j => j.name === JOURNAL_NAME) || null;
}

function findCopies(revealed, sourceUuid) {
  return (revealed.pages || []).filter(p => p.copiedFrom === sourceUuid);
}

async function undoApplied() {
  const recent = await tool('list-recent-changes', { limit: 20 });
  const change = (recent.changes || []).find(
    c => c.changeId === appliedChangeId && c.mode === 'apply'
  );
  assert(change, `change ${appliedChangeId} is not in list-recent-changes`);
  assert(change.canUndo !== false, `change ${appliedChangeId} cannot be undone`);
  // undo-change is destructive class: it needs both confirmations.
  await tool(
    'undo-change',
    { changeId: appliedChangeId },
    { confirm: true, confirmDestructive: true }
  );
  appliedChangeId = null;
}

async function main() {
  console.log(`# Live round trip against ${BASE} (test world ${EXPECTED_WORLD})`);

  // 1. dashboard reachable, control channel connected
  await step('dashboard reachable, control channel connected', async () => {
    const { status, data } = await http('/api/health', { timeoutMs: 8000 });
    if (status !== 200 || !data) throw new EnvError(`/api/health answered HTTP ${status}`);
    if (data.controlChannel !== 'connected') {
      throw new EnvError('the dashboard cannot reach the test bridge (control channel is down)');
    }
    return `split ${data.splitEnabled ? 'on' : 'off'}`;
  }).then(r => {
    if (!r.ok) throw new EnvError('dashboard check failed');
  });

  // 2. Foundry live and the right world
  await step('Foundry live and the world is ' + EXPECTED_WORLD, async () => {
    let info;
    try {
      info = await tool('get-world-info', {});
    } catch (e) {
      if (/module not connected|not connected/i.test(String(e.message))) {
        throw new EnvError('the bridge has no Foundry link (join the test world as a GM)');
      }
      throw e;
    }
    if (info.id !== EXPECTED_WORLD) {
      throw new EnvError(
        `the connected world is "${info.id}", not "${EXPECTED_WORLD}"; refusing to write`
      );
    }
    return `${info.title} (${info.id})`;
  });

  // 3. GM Actions on
  await step('GM Actions switched on', async () => {
    const tools = await http('/api/tools');
    assert(tools.status === 200 && tools.data, `/api/tools answered HTTP ${tools.status}`);
    gmActionsBefore = tools.data.gmActionsEnabled === true;
    if (!gmActionsBefore) await setGmActions(true);
    return gmActionsBefore ? 'was already on' : 'was off, now on (restored at the end)';
  });

  try {
    // 4. set up the test journal
    const setup = await step('test journal with its page exists', async () => {
      let journal = await findJournal();
      let note = 'reused';
      if (!journal) {
        await tool(
          'create-quest-journal',
          {
            questTitle: JOURNAL_NAME,
            questDescription: 'Harmless test data for scripts/live-roundtrip.mjs. Safe to delete.',
            additionalPages: [
              { name: PAGE_NAME, content: '<p>Roundtrip test text. Nothing to see here.</p>' },
            ],
          },
          { confirm: true }
        );
        journal = await findJournal();
        note = 'created';
      }
      assert(journal, `journal "${JOURNAL_NAME}" not found after creating it`);
      const page = (journal.pages || []).find(p => p.name === PAGE_NAME);
      assert(
        page,
        `page "${PAGE_NAME}" is missing in the test journal (delete the journal and rerun)`
      );
      pageUuid = `JournalEntry.${journal.id}.JournalEntryPage.${page.id}`;
      return `${note}, ${pageUuid}`;
    });
    if (!setup.ok) return;

    // Leftover copy from an aborted earlier run: hide it first so this run starts clean.
    const leftovers = findCopies(await tool('list-revealed-pages', {}), pageUuid);
    if (leftovers.length > 0) {
      await step('clean up a leftover copy from an earlier run', async () => {
        const hide = await tool('plan-page-reveal', { pageUuid, action: 'hide' });
        await tool(
          'apply-planned-change',
          { planId: hide.planId },
          { confirm: true, confirmDestructive: true }
        );
        const after = findCopies(await tool('list-revealed-pages', {}), pageUuid);
        assert(after.length === 0, 'the leftover copy is still listed after hiding it');
        return 'hidden';
      });
    }

    // 5. plan
    let planId = null;
    const planned = await step('plan: plan-page-reveal (reveal as a copy)', async () => {
      const plan = await tool('plan-page-reveal', { pageUuid, action: 'reveal', copy: true });
      assert(plan && plan.planId, 'the plan has no planId');
      planId = plan.planId;
      return `planId ${planId}`;
    });
    if (!planned.ok) return;

    // 6. confirm (apply)
    const applied = await step('confirm: apply-planned-change', async () => {
      try {
        const change = await tool(
          'apply-planned-change',
          { planId },
          { confirm: true, confirmDestructive: true }
        );
        assert(change && change.changeId, 'the apply returned no changeId');
        appliedChangeId = change.changeId;
        return `changeId ${appliedChangeId}`;
      } catch (e) {
        if (/switched off/i.test(String(e.message))) {
          throw new EnvError(
            'the "handouts" feature is switched off in the test world. One-time setup: Settings > Game Settings > "Foundry AI Tool" > switch on "AI Tool: Handouts (writes)"'
          );
        }
        throw e;
      }
    });
    if (!applied.ok) return;

    // 7. verify through read tools
    await step('verify: the copy is listed and handed to players', async () => {
      const copies = findCopies(await tool('list-revealed-pages', {}), pageUuid);
      assert(copies.length === 1, `expected 1 copy in list-revealed-pages, found ${copies.length}`);
      assert(copies[0].exists, 'the copy is listed but does not exist in Foundry');
      const handouts = await tool('get-player-handouts', {});
      const mine = (handouts.handouts || []).filter(h => h.uuid === copies[0].uuid);
      assert(mine.length === 1, 'get-player-handouts does not list the copy');
      return `copy ${copies[0].uuid}`;
    });

    // 8. undo
    await step('undo: list-recent-changes, undo-change', async () => {
      await undoApplied();
      return 'undone';
    });

    // 9. verify gone
    await step('verify gone: no copy listed or handed to players', async () => {
      const copies = findCopies(await tool('list-revealed-pages', {}), pageUuid);
      assert(copies.length === 0, `${copies.length} copy still listed after the undo`);
      const handouts = await tool('get-player-handouts', {});
      const left = (handouts.handouts || []).filter(h => h.title === PAGE_NAME);
      assert(left.length === 0, 'get-player-handouts still lists the page after the undo');
      return 'gone';
    });
  } finally {
    // 10. clean up: a change that is still applied is undone, GM Actions go back.
    if (appliedChangeId) {
      await step('clean up: undo the change a failed step left applied', async () => {
        await undoApplied();
        return 'undone';
      }).catch(() => {});
    }
    if (gmActionsBefore === false) {
      await step('clean up: GM Actions back off', async () => {
        await setGmActions(false);
        return 'off';
      }).catch(() => {});
    }
  }
}

main()
  .then(() => {
    console.log('');
    if (failed === 0) {
      console.log('RESULT: all steps passed');
      process.exit(0);
    }
    console.log(`RESULT: ${failed} step(s) failed`);
    process.exit(EXIT_FAIL);
  })
  .catch(async e => {
    if (e instanceof EnvError) {
      // Best effort: put the switch back if we had turned it on.
      if (gmActionsBefore === false) await setGmActions(false).catch(() => {});
      console.error('');
      console.error(`ENVIRONMENT NOT READY: ${e.message}`);
      console.error(
        'Start the test environment (pwsh scripts/test-env/start.ps1), join the test world'
      );
      console.error(
        'as a GM in a browser, switch on "AI Tool: Handouts (writes)", then run this again.'
      );
      process.exit(EXIT_ENV);
    }
    console.error('ROUNDTRIP ABORTED:', e);
    process.exit(EXIT_FAIL);
  });
