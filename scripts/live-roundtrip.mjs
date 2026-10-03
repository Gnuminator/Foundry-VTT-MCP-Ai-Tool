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
 * client joined to the world `ai-tool-test` (or `--world ai-tool-walkthrough`, see
 * `scripts/test-worlds.mjs`; the passwordless "Claude" user) so the
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
 *  10. session notes (D-087): stage a test session on the test bridge's control port (31514,
 *      ROUNDTRIP_CONTROL_PORT), wait until the bridge puts it into Foundry by itself (journal
 *      "<today>: AI Tool Roundtrip Session (safe to delete)" with the pages Recap, GM summary,
 *      Scenes), undo it (back to staged, no automatic put again), put it by hand through the
 *      dashboard route and undo again
 *  11. clean up: GM Actions back to its previous state; if a step failed after the apply,
 *      the change is undone anyway so the world is left as it was
 *
 * One-time manual setup (cannot be done through the tool API):
 *   - In the test world (Foundry), Settings > Game Settings > category "Foundry AI Tool":
 *     switch on "AI Tool: Handouts (writes)" (and keep "Allow Write Operations" on, the
 *     default). Without it step 6 fails with 'The "handouts" feature is switched off' and the
 *     script exits with 2. A reveal also creates the player journal "Handouts" on first use
 *     and leaves it in place (empty after the undo); that is harmless.
 *   - Also switch on "AI Tool: Session notes (writes)" for step 10 (the script exits with 2
 *     while it is off). The folder "Session notes" stays in the test world (empty).
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

import net from 'node:net';

import { parseWorldArg, TEST_WORLDS } from './test-worlds.mjs';

const TEST_DASHBOARD_PORT = 3100;
let EXPECTED_WORLD;
try {
  EXPECTED_WORLD = parseWorldArg(process.argv.slice(2));
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(2);
}
const LIVE_BRIDGE_PORTS = [31414, 31415, 31416];
const JOURNAL_NAME = 'AI Tool Roundtrip Test (safe to delete)';
const PAGE_NAME = 'Roundtrip Handout';
const NOTES_SESSION_ID = 'roundtrip-test';
const NOTES_TITLE = 'AI Tool Roundtrip Session (safe to delete)';
// The test bridge's control port (stage is a pipeline-only control method, not a dashboard route).
const TEST_CONTROL_PORT = Number(process.env.ROUNDTRIP_CONTROL_PORT || 31514);
if (LIVE_BRIDGE_PORTS.includes(TEST_CONTROL_PORT)) {
  console.error(`REFUSED: port ${TEST_CONTROL_PORT} is the live bridge.`);
  process.exit(2);
}

const EXIT_FAIL = 1;
const EXIT_ENV = 2;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`live-roundtrip: plan -> confirm -> verify -> undo -> verify gone, on the TEST world.

Usage: node scripts/live-roundtrip.mjs [--world <id>] [--help]

  --world <id>   the test world to run in: ${TEST_WORLDS.join(', ')} (default ai-tool-test)

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

// --- Session notes (recap lane, D-087) ----------------------------------------

let notesChangeId = null; // set while the test session's notes are in Foundry

/** One `session_notes` request on the TEST bridge's control port (stage is pipeline-only). */
function controlCall(params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: TEST_CONTROL_PORT });
    let buf = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no answer from the test bridge on ${TEST_CONTROL_PORT}`));
    }, 30000);
    socket.on('error', e => {
      clearTimeout(timer);
      reject(
        e.code === 'ECONNREFUSED'
          ? new EnvError(`the test bridge's control port ${TEST_CONTROL_PORT} is not listening`)
          : e
      );
    });
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: 'roundtrip', method: 'session_notes', params })}\n`);
    });
    socket.on('data', chunk => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      socket.end();
      const answer = JSON.parse(buf.slice(0, nl));
      if (answer.error) {
        const err = new Error(`${answer.error.message} (${answer.error.code ?? 'no code'})`);
        err.code = answer.error.code;
        reject(err);
      } else resolve(answer.result);
    });
  });
}

async function notesItem() {
  const { status, data } = await http(`/api/session-notes/${NOTES_SESSION_ID}`);
  if (status === 404) return null;
  assert(status === 200, `GET /api/session-notes answered HTTP ${status}: ${data?.error?.message}`);
  return data;
}

async function waitForNotes(want, seconds = 30) {
  for (let i = 0; i < seconds * 2; i += 1) {
    const item = await notesItem();
    if (item?.status === want) return item;
    if (item?.waitingFor?.includes('feature-off')) {
      throw new EnvError(
        'the "session-notes" feature is switched off in the test world. One-time setup: Settings > Game Settings > "Foundry AI Tool" > switch on "AI Tool: Session notes (writes)"'
      );
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`the test session's notes did not reach "${want}" within ${seconds} s`);
}

async function undoNotes() {
  await tool(
    'undo-change',
    { changeId: notesChangeId },
    { confirm: true, confirmDestructive: true }
  );
  notesChangeId = null;
}

async function notesJournal(name) {
  const listed = await tool('list-journals', {});
  return (listed.journals || []).find(j => j.name === name) || null;
}

async function sessionNotesRoundtrip() {
  const date = new Date().toISOString().slice(0, 10);
  const name = `${date}: ${NOTES_TITLE}`;

  // A run that stopped half way left the notes in Foundry: undo them so staging works again.
  const leftover = await notesItem();
  if (leftover?.status === 'in-foundry' && leftover.changeId) {
    await step('clean up the test session notes an earlier run left in Foundry', async () => {
      notesChangeId = leftover.changeId;
      await undoNotes();
      return 'undone';
    });
  }

  const staged = await step('session notes: stage over the control port', async () => {
    const item = await controlCall({
      action: 'stage',
      sessionId: NOTES_SESSION_ID,
      date,
      title: NOTES_TITLE,
      languages: ['da', 'en'],
      pages: [
        { key: 'recap', html: '<p>Rundtur.</p><h2>English</h2><p>Round trip.</p>' },
        { key: 'summary', html: '<p>Kun GM.</p><h2>English</h2><p>GM only.</p>' },
        { key: 'scenes', html: '<h2>1. Test</h2><p>Ingenting.</p><h2>English</h2><p>Nothing.</p>' },
      ],
    });
    assert(item && item.status === 'staged', `stage answered status ${item && item.status}`);
    return `staged ${item.sessionId}`;
  });
  if (!staged.ok) return;

  const put = await step('session notes: the bridge puts them into Foundry by itself', async () => {
    const item = await waitForNotes('in-foundry');
    notesChangeId = item.changeId;
    assert(item.recapPageUuid, 'no Recap page uuid on the item');
    const journal = await notesJournal(name);
    assert(journal, `journal "${name}" not found`);
    const pages = (journal.pages || []).map(p => p.name).join(', ');
    assert(pages === 'Recap, GM summary, Scenes', `pages are "${pages}"`);
    assert(!item.lastError, `read back: ${item.lastError}`);
    return `${item.changeId}, ${journal.id}`;
  });
  if (!put.ok) return;

  const undone = await step('session notes: undo takes the journal out again', async () => {
    await undoNotes();
    const item = await waitForNotes('staged', 10);
    assert(item.autoPut === false, 'after an undo the bridge must not put the notes again');
    assert(!(await notesJournal(name)), 'the journal is still there after the undo');
    return 'staged, autoPut off';
  });
  if (!undone.ok) return;

  await step('session notes: a manual put (the card\'s "Put in Foundry"), then undo', async () => {
    const { status, data } = await http(`/api/session-notes/${NOTES_SESSION_ID}/put`, {
      method: 'POST',
    });
    assert(status === 200, `put answered HTTP ${status}: ${data?.error?.message}`);
    notesChangeId = data.changeId;
    assert(data.item.status === 'in-foundry', `put left status ${data.item.status}`);
    assert(await notesJournal(name), 'the journal is missing after the manual put');
    await undoNotes();
    assert(!(await notesJournal(name)), 'the journal is still there after the second undo');
    return 'put and undone';
  });
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

    await sessionNotesRoundtrip();
  } finally {
    if (notesChangeId) {
      await step('clean up: undo the session notes a failed step left in Foundry', async () => {
        await undoNotes();
        return 'undone';
      }).catch(() => {});
    }
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
        'as a GM in a browser, switch on "AI Tool: Handouts (writes)" and "AI Tool: Session notes (writes)", then run this again.'
      );
      process.exit(EXIT_ENV);
    }
    console.error('ROUNDTRIP ABORTED:', e);
    process.exit(EXIT_FAIL);
  });
