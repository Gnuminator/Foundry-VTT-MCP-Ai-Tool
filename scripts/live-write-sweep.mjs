/**
 * Live write sweep (I-016): runs the direct-write tools once against the local TEST world
 * and puts the world back. Talks ONLY to the local TEST dashboard (http://127.0.0.1:3100,
 * see scripts/test-env) and refuses every other port, in particular the live bridge ports
 * 31414-31416. Complements `npm run live:roundtrip` (one guarded write and its undo).
 *
 *   node scripts/live-write-sweep.mjs            (or: npm run live:sweep)
 *   node scripts/live-write-sweep.mjs --help
 *
 * Needs the test environment running (`pwsh scripts/test-env/start.ps1`) and a GM client
 * joined to the world `ai-tool-test` (the passwordless "Claude" user). Exits with 2 when it
 * cannot reach them.
 *
 * How it stays clean:
 *   - Everything it creates is named "AI Tool Sweep ..." (NPCs, a compendium wolf and its
 *     token, journals, a campaign dashboard, world items, folders).
 *   - It changes only its own documents where it can (its own token for moves, damage,
 *     conditions, light and rolls; its own NPC for features, loot, rests and ownership).
 *   - Damage, healing, conditions and resources go through plan-actor-change (F5, D-082):
 *     each step plans, applies, checks, undoes with undo-change and checks again.
 *   - Scene-wide changes are put back by the tools themselves: map notes and templates are
 *     deleted, the scene mood and the active scene are restored.
 *   - At the end the dashboard's test route (`POST /api/test/live-sweep`, mode `cleanup`)
 *     has the module delete every "AI Tool Sweep" document and the chat messages and
 *     combats created since the run started. The module refuses that outside the world
 *     `ai-tool-test`. The same route takes a scene snapshot first (mode `snapshot`, for the
 *     mood) and starts a combat of the sweep's own tokens (mode `combat`), since no tool
 *     reads the lighting or creates a combat.
 *   - GM Actions go back to their previous state. The vault's session log keeps the two
 *     `mark-play-session` lines (they are the test bridge's own log).
 *
 * Output: one PASS / FAIL / SKIP line per step, then a summary. Exit code 0 when nothing
 * failed (skips are fine), 1 when a step failed, 2 when the environment is not ready.
 *
 * Not run: `use-item` opens a dialog in the GM's browser that needs a click (pass
 * `--with-dialogs` to run it anyway and click it yourself). The `request-*` tools need the
 * target player logged in (SWEEP_PLAYER, default "Player"); they are skipped when not.
 *
 * Environment: COGM_BASE (default http://127.0.0.1:3100; only port 3100 on this machine is
 * accepted), COGM_TOKEN (GM token, only when the test dashboard runs with the player/GM
 * split on), SWEEP_PLAYER (user name for the roll requests, default "Player").
 */

const TEST_DASHBOARD_PORT = 3100;
const EXPECTED_WORLD = 'ai-tool-test';
const LIVE_BRIDGE_PORTS = [31414, 31415, 31416];
const PREFIX = 'AI Tool Sweep';
const FOLDER = `${PREFIX} (safe to delete)`;
const PLAYER = process.env.SWEEP_PLAYER || 'Player';
const WITH_DIALOGS = process.argv.includes('--with-dialogs');

const EXIT_FAIL = 1;
const EXIT_ENV = 2;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`live-write-sweep: run the direct-write tools once on the TEST world, then clean up.

Usage: node scripts/live-write-sweep.mjs [--with-dialogs] [--help]

Only talks to the test dashboard on 127.0.0.1:${TEST_DASHBOARD_PORT} (COGM_BASE may name
localhost, 127.0.0.1 or [::1], but only port ${TEST_DASHBOARD_PORT}). Never the live bridge (31414-31416).
Start the test environment first: pwsh scripts/test-env/start.ps1 (see the foundry-test-env skill)
and join the world as "Claude". Everything it makes is named "${PREFIX} ..." and deleted at the end.

  --with-dialogs   also run use-item, which opens a dialog in the GM's browser (click it)

Exit codes: 0 nothing failed (skips are fine), 1 a step failed, 2 environment not ready.
Read the header of this file for the details.`);
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
class SkipError extends Error {}

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

/** Tools whose class is destructive in the dashboard's tool policy (both confirmations). */
const DESTRUCTIVE = new Set([
  'delete-map-note',
  'delete-measured-template',
  'remove-actor-ownership',
  'clear-module-errors',
  'undo-change',
]);

/**
 * Calls a bridge tool through the dashboard with the confirmations it needs. Throws with
 * the tool's message on failure, including the tools that answer a bad argument with a
 * plain "Parameter error: ..." or "Error: ..." string instead of failing.
 */
async function tool(name, args = {}, { destructive = false } = {}) {
  const flags = {
    confirm: true,
    ...(destructive || DESTRUCTIVE.has(name) ? { confirmDestructive: true } : {}),
  };
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
  const result = data.result;
  if (typeof result === 'string' && /^(Parameter error|Error)\b/i.test(result.trim())) {
    throw new Error(`${name}: ${result.trim().replace(/\s+/g, ' ')}`);
  }
  return result;
}

/** The dashboard's test-world helper (snapshot, combat, cleanup). */
async function helper(body) {
  const { status, data } = await http('/api/test/live-sweep', {
    method: 'POST',
    body,
    timeoutMs: 120000,
  });
  if (!data || data.ok !== true) {
    const why = (data && (data.error || data.code)) || `HTTP ${status}`;
    throw new Error(`live-sweep helper (${body.mode}): ${String(why).replace(/\s+/g, ' ')}`);
  }
  return data.result;
}

// --- Step runner ------------------------------------------------------------

const counts = { pass: 0, fail: 0, skip: 0 };
let stepNo = 0;

async function step(label, fn) {
  stepNo += 1;
  const tag = `[${String(stepNo).padStart(2, '0')}]`;
  try {
    const detail = await fn();
    counts.pass += 1;
    console.log(`PASS ${tag} ${label}${detail ? `: ${detail}` : ''}`);
    return true;
  } catch (e) {
    if (e instanceof EnvError) throw e;
    if (e instanceof SkipError) {
      counts.skip += 1;
      console.log(`SKIP ${tag} ${label}: ${e.message}`);
      return false;
    }
    counts.fail += 1;
    console.log(`FAIL ${tag} ${label}: ${e && e.message ? e.message : e}`);
    return false;
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function skip(reason) {
  throw new SkipError(reason);
}

/** Short JSON for step details. */
function brief(value, max = 120) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * F5 (D-082): a plan tool (plan-actor-change by default, plan-token-change for tokens), then
 * apply-planned-change. Returns the plan (with its per-target preview) and the applied change
 * (its changeId is what undo-change takes). A destructive plan (a token delete) gets both
 * confirmations.
 */
async function planAndApply(args, planTool = 'plan-actor-change') {
  const plan = await tool(planTool, args);
  assert(plan && plan.planId, `no plan: ${brief(plan)}`);
  const change = await tool(
    'apply-planned-change',
    { planId: plan.planId },
    { destructive: plan.risk === 'destructive' }
  );
  assert(change && change.changeId, `not applied: ${brief(change)}`);
  return { plan, change };
}

async function undo(change) {
  const r = await tool('undo-change', { changeId: change.changeId });
  assert(r && r.mode === 'undo', `undo: ${brief(r)}`);
  return r;
}

/** The sweep token's current hit points (get-token-positions reports hp as a number or {value}). */
async function wolfHp() {
  const t = await wolfToken();
  const hp = t && t.hp;
  const value = hp && typeof hp === 'object' ? hp.value : hp;
  assert(typeof value === 'number', `no hp on the sweep token: ${brief(t)}`);
  return value;
}

async function wolfConditions() {
  const t = await wolfToken();
  return JSON.stringify((t && t.conditions) || []).toLowerCase();
}

// --- Shared state -----------------------------------------------------------

/** What the run set up, and what the clean-up has to put back. */
const ctx = {
  since: 0,
  gmActionsBefore: null,
  scene: null, // { id, name } of the active scene at the start
  mood: null, // { darkness, globalLight } at the start
  npcName: `${PREFIX} NPC`,
  npcId: null,
  wolfName: `${PREFIX} Wolf`,
  wolfActorId: null,
  wolfTokenId: null,
  wolfStart: null, // { x, y }
  journalId: null,
  itemId: null,
  noteId: null,
  templateId: null,
  switchedScene: false,
};

async function setGmActions(value) {
  const { status, data } = await http('/api/control', {
    method: 'POST',
    body: { action: 'set-gm-actions', value },
  });
  assert(status === 200, `/api/control answered HTTP ${status}`);
  return data;
}

/** The sweep token's entry in get-token-positions (tokenId, x, y, hp, conditions). */
async function wolfToken() {
  const positions = await tool('get-token-positions', {});
  const tokens = (positions && positions.tokens) || [];
  return tokens.find(t => (t.tokenId || t.id) === ctx.wolfTokenId) || null;
}

/** First Actor hit of a compendium search, as { packId, itemId }. */
function firstCompendiumActor(result) {
  const rows = Array.isArray(result)
    ? result
    : (result && (result.results || result.items || result.entries)) || [];
  for (const r of rows) {
    const pack = r.pack && typeof r.pack === 'object' ? r.pack.id : r.pack;
    const packId = r.packId || pack;
    const itemId = r.id || r._id || r.itemId;
    if (packId && itemId) return { packId, itemId, name: r.name };
  }
  return null;
}

// --- 1. Environment ---------------------------------------------------------

async function checkEnvironment() {
  const { status, data } = await http('/api/health');
  if (status !== 200 || !data) throw new EnvError(`/api/health answered HTTP ${status}`);
  const channel = data.controlChannel || (data.status && data.status.controlChannel);
  if (channel && channel !== 'connected') {
    throw new EnvError(`the dashboard's control channel to the test bridge is "${channel}"`);
  }
  let info;
  try {
    info = await tool('get-world-info', {});
  } catch (e) {
    throw new EnvError(`Foundry is not reachable through the bridge (${e.message})`);
  }
  if (!info || info.id !== EXPECTED_WORLD) {
    throw new EnvError(
      `the bridge is connected to world "${info && info.id}", not "${EXPECTED_WORLD}"`
    );
  }
  return `${info.title} (${info.id})`;
}

// --- 2. Set-up: snapshot, GM Actions, run start -----------------------------

async function setUp() {
  await step('GM Actions switched on', async () => {
    const { data } = await http('/api/tools');
    ctx.gmActionsBefore = !!(data && data.gmActionsEnabled);
    await setGmActions(true);
    return `was ${ctx.gmActionsBefore ? 'on' : 'off'}, now on (restored at the end)`;
  });
  // A little slack: Foundry stamps createdTime with its own clock (same PC).
  ctx.since = Date.now() - 2000;
  await step('snapshot: active scene and its lighting', async () => {
    const snap = await helper({ mode: 'snapshot' });
    assert(snap.sceneId, 'no active scene; activate "Test Arena" first');
    ctx.scene = { id: snap.sceneId, name: snap.sceneName };
    ctx.mood = { darkness: snap.darkness, globalLight: snap.globalLight };
    return `${snap.sceneName}: darkness ${snap.darkness}, global light ${snap.globalLight}`;
  });
}

// --- 3. Build tools: an NPC from scratch, a wolf from the compendium ---------

async function buildTools() {
  await step('dnd5e-create-npc', async () => {
    const r = await tool('dnd5e-create-npc', {
      name: ctx.npcName,
      creatureType: 'humanoid',
      size: 'medium',
      cr: 1,
      hpAverage: 22,
      hpFormula: '4d8+4',
      acMode: 'flat',
      acValue: 13,
      abilities: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 },
    });
    ctx.npcId = r && r.actor && r.actor.id;
    assert(ctx.npcId, `no actor id in ${brief(r)}`);
    return `${r.actor.name} (${ctx.npcId})`;
  });
  const features = [
    ['passive', { featureName: `${PREFIX} Keen Senses` }],
    [
      'attack',
      {
        featureName: `${PREFIX} Club`,
        attackType: 'melee',
        damageParts: [{ number: 1, denomination: 6, type: 'bludgeoning' }],
      },
    ],
    [
      'save',
      {
        featureName: `${PREFIX} Spit`,
        saveAbility: 'dex',
        saveDC: 12,
        damageParts: [{ number: 2, denomination: 6, type: 'acid' }],
        areaType: 'cone',
        areaSize: 15,
      },
    ],
    [
      'attack-with-save',
      {
        featureName: `${PREFIX} Venom Bite`,
        attackType: 'melee',
        damageParts: [{ number: 1, denomination: 6, type: 'piercing' }],
        saveAbility: 'con',
        saveDC: 11,
        saveDamageParts: [{ number: 2, denomination: 4, type: 'poison' }],
      },
    ],
    [
      'aura',
      {
        featureName: `${PREFIX} Cold Aura`,
        damageParts: [{ number: 1, denomination: 4, type: 'cold' }],
        areaType: 'emanation',
        areaSize: 10,
      },
    ],
    ['spellcasting', { spellcastingClass: 'wizard', spellcastingLevel: 3 }],
    ['spells', { spellNames: ['Fire Bolt', 'Magic Missile'] }],
  ];
  for (const [featureType, extra] of features) {
    await step(`dnd5e-add-feature (${featureType})`, async () => {
      if (!ctx.npcId) skip('no sweep NPC');
      const r = await tool('dnd5e-add-feature', {
        actorIdentifier: ctx.npcId,
        featureType,
        ...extra,
      });
      if (featureType === 'spells') {
        const added = (r && r.added) || [];
        assert(added.length > 0, `no spell added: ${brief(r)}`);
        return `${added.length} added`;
      }
      return brief(r && r.item ? r.item.name || r.item.id : r, 80);
    });
  }
  await step('dnd5e-add-features-from-compendium', async () => {
    if (!ctx.npcId) skip('no sweep NPC');
    const r = await tool('dnd5e-add-features-from-compendium', {
      actorIdentifier: ctx.npcId,
      featureNames: ['Pack Tactics'],
    });
    const added = (r && r.added) || [];
    const notFound = (r && r.notFound) || [];
    assert(added.length > 0 || notFound.length > 0, `unexpected result ${brief(r)}`);
    return `added ${added.length}, not found ${notFound.length}`;
  });
  await step('create-actor-from-compendium (wolf, on the scene)', async () => {
    const found = firstCompendiumActor(
      await tool('search-compendium', { query: 'Wolf', packType: 'Actor' })
    );
    if (!found) skip('no Actor named Wolf in the compendiums');
    const r = await tool('create-actor-from-compendium', {
      packId: found.packId,
      itemId: found.itemId,
      names: [ctx.wolfName],
      addToScene: true,
      placement: { type: 'center' },
    });
    const actors = (r && r.details && r.details.actors) || (r && r.actors) || [];
    ctx.wolfActorId = actors[0] && (actors[0].id || actors[0].actorId);
    assert(ctx.wolfActorId, `no actor id in ${brief(r)}`);
    const positions = await tool('get-token-positions', {});
    const token = ((positions && positions.tokens) || []).find(
      // By actor only: a token left by an earlier, interrupted run has the same name.
      t => t.actorId === ctx.wolfActorId
    );
    assert(token, 'the new token is not on the active scene');
    ctx.wolfTokenId = token.tokenId || token.id;
    ctx.wolfStart = { x: token.x, y: token.y };
    return `${found.packId}/${found.itemId} -> token ${ctx.wolfTokenId}`;
  });
}

// --- 4. World items and journals -----------------------------------------------

async function itemAndJournalTools() {
  await step('manage-world-items (create)', async () => {
    const r = await tool('manage-world-items', {
      action: 'create',
      items: [{ name: `${PREFIX} Item`, type: 'loot' }],
      folder: FOLDER,
    });
    ctx.itemId = r && r.created && r.created[0] && r.created[0].id;
    assert(ctx.itemId, `no item id in ${brief(r)}`);
    return `${ctx.itemId} in folder ${r.folderName}`;
  });
  await step('manage-world-items (update)', async () => {
    if (!ctx.itemId) skip('no sweep item');
    const r = await tool('manage-world-items', {
      action: 'update',
      updates: [{ id: ctx.itemId, name: `${PREFIX} Item (renamed)` }],
    });
    const updated = (r && r.updated) || [];
    assert(updated[0] && updated[0].name === `${PREFIX} Item (renamed)`, brief(r));
    return 'renamed';
  });
  await step('manage-world-items (add-to-actor)', async () => {
    if (!ctx.npcId) skip('no sweep NPC');
    const r = await tool('manage-world-items', {
      action: 'add-to-actor',
      actorIdentifier: ctx.npcId,
      // A consumable with three uses, so the resource step has something to change
      // (dnd5e loot has no uses).
      items: [
        { name: `${PREFIX} Trinket`, type: 'consumable', system: { uses: { max: '3', spent: 0 } } },
      ],
    });
    assert(r && r.created && r.created.length === 1, brief(r));
    return `${r.created[0].name} on ${r.actorName}`;
  });
  await step('create-quest-journal', async () => {
    const r = await tool('create-quest-journal', {
      questTitle: `${PREFIX} Quest`,
      questDescription: 'Made by the live write sweep; deleted at the end of the run.',
      questType: 'side',
      difficulty: 'easy',
      folderName: FOLDER,
    });
    ctx.journalId = r && r.journalId;
    assert(ctx.journalId, `no journal id in ${brief(r)}`);
    return `${r.journalName} (${ctx.journalId})`;
  });
  await step('update-quest-journal', async () => {
    if (!ctx.journalId) skip('no sweep journal');
    const r = await tool('update-quest-journal', {
      journalId: ctx.journalId,
      newContent: 'The sweep made progress.',
      updateType: 'progress',
    });
    assert(r && r.verified !== false, brief(r));
    return r.pageName || 'updated';
  });
  await step('link-quest-to-npc', async () => {
    if (!ctx.journalId) skip('no sweep journal');
    const r = await tool('link-quest-to-npc', {
      journalId: ctx.journalId,
      npcName: ctx.npcName,
      relationship: 'quest_giver',
    });
    assert(r && r.success !== false, brief(r));
    return 'linked';
  });
  await step('create-campaign-dashboard', async () => {
    const r = await tool('create-campaign-dashboard', {
      campaignTitle: `${PREFIX} Campaign`,
      campaignDescription: 'Made by the live write sweep; deleted at the end of the run.',
      template: 'dungeon-crawl',
    });
    assert(r && r.dashboardJournalId, `no dashboard id in ${brief(r)}`);
    return r.dashboardName;
  });
}

// --- 5. Tokens (the sweep's own wolf token) ------------------------------------

async function tokenTools() {
  const needWolf = () => {
    if (!ctx.wolfTokenId) skip('no sweep token on the scene');
  };
  await step('plan-token-change move (one square right, undo)', async () => {
    needWolf();
    const { x, y } = ctx.wolfStart;
    const { plan, change } = await planAndApply(
      { action: 'move', tokens: [ctx.wolfTokenId], dx: 1 },
      'plan-token-change'
    );
    const moved = await wolfToken();
    assert(
      moved && moved.x > x && moved.y === y,
      `token at ${brief(moved && { x: moved.x, y: moved.y })}`
    );
    await undo(change);
    const back = await wolfToken();
    assert(
      back && back.x === x && back.y === y,
      `after undo at ${brief(back && { x: back.x, y: back.y })}`
    );
    return `${plan.targets[0].line}; undone`;
  });
  await step('plan-token-change update (elevation 10, undo)', async () => {
    needWolf();
    const { change } = await planAndApply(
      { action: 'update', tokens: [ctx.wolfTokenId], elevation: 10 },
      'plan-token-change'
    );
    assert((await wolfToken())?.elevation === 10, 'elevation not 10 after the apply');
    await undo(change);
    assert((await wolfToken())?.elevation === 0, 'elevation not 0 after the undo');
    return 'elevation 0 -> 10 -> undone';
  });
  await step('plan-actor-change condition (prone on, undo)', async () => {
    needWolf();
    const { plan, change } = await planAndApply({
      action: 'condition',
      targets: [ctx.wolfTokenId],
      condition: 'prone',
    });
    assert((await wolfConditions()).includes('prone'), 'prone not on after the apply');
    await undo(change);
    assert(!(await wolfConditions()).includes('prone'), 'prone still on after the undo');
    return `${plan.targets.map(t => t.line).join('; ')}; undone`;
  });
  await step('plan-actor-change clear-conditions (prone, undo the clear)', async () => {
    needWolf();
    await planAndApply({ action: 'condition', targets: [ctx.wolfTokenId], condition: 'prone' });
    const cleared = await planAndApply({
      action: 'clear-conditions',
      targets: [ctx.wolfTokenId],
      conditions: ['prone'],
    });
    assert(!(await wolfConditions()).includes('prone'), 'prone still on after clear-conditions');
    await undo(cleared.change);
    assert((await wolfConditions()).includes('prone'), 'prone not back after undoing the clear');
    // The undo re-created Prone, so the first change ("prone on") can no longer be undone (a
    // conflict, nothing written); a new plan takes it off.
    await planAndApply({
      action: 'condition',
      targets: [ctx.wolfTokenId],
      condition: 'prone',
      active: false,
    });
    assert(!(await wolfConditions()).includes('prone'), 'prone still on after taking it off');
    return 'on, cleared, clear undone, taken off again';
  });
  await step('plan-token-change update (a torch: light 40/20, undo)', async () => {
    needWolf();
    const { plan, change } = await planAndApply(
      { action: 'update', tokens: [ctx.wolfTokenId], lightDim: 40, lightBright: 20 },
      'plan-token-change'
    );
    const lit = await tool('get-token-details', { tokenId: ctx.wolfTokenId });
    const light = (lit && (lit.light || (lit.token && lit.token.light))) || null;
    if (light) assert(light.dim === 40 && light.bright === 20, `light ${brief(light)}`);
    await undo(change);
    return `${plan.targets[0].line}; undone`;
  });
  await step('plan-actor-change damage and healing (undo both, newest first)', async () => {
    needWolf();
    const start = await wolfHp();
    const hurt = await planAndApply({
      action: 'damage',
      targets: [ctx.wolfTokenId],
      amount: 3,
      damageType: 'slashing',
    });
    const afterDamage = await wolfHp();
    assert(afterDamage === start - 3, `hp ${start} -> ${afterDamage} after 3 damage`);
    const healed = await planAndApply({ action: 'healing', targets: [ctx.wolfTokenId], amount: 2 });
    const afterHealing = await wolfHp();
    assert(afterHealing === start - 1, `hp ${afterDamage} -> ${afterHealing} after 2 healing`);
    await undo(healed.change);
    assert((await wolfHp()) === start - 3, 'healing not undone');
    await undo(hurt.change);
    const back = await wolfHp();
    assert(back === start, `hp ${back} after both undos, expected ${start}`);
    return `hp ${start} -> ${afterDamage} -> ${afterHealing} -> undone to ${back} (${hurt.plan.targets[0].line})`;
  });
  await step('roll-saving-throws (dex save, whisper)', async () => {
    needWolf();
    const r = await tool('roll-saving-throws', {
      targets: [ctx.wolfTokenId],
      rollType: 'save',
      ability: 'dex',
      dc: 12,
    });
    assert(r && r.results && r.results.length === 1, brief(r));
    return `total ${r.results[0].total}`;
  });
  await step('roll-npc-check (perception, whisper)', async () => {
    if (!ctx.wolfActorId) skip('no sweep wolf');
    const r = await tool('roll-npc-check', {
      actorName: ctx.wolfName,
      rollType: 'skill',
      rollTarget: 'prc',
      isPublic: false,
    });
    return `total ${r && r.total}`;
  });
  await step('use-npc-activity (Bite, whisper)', async () => {
    if (!ctx.wolfActorId) skip('no sweep wolf');
    const r = await tool('use-npc-activity', {
      actorName: ctx.wolfName,
      itemName: 'Bite',
      targetAC: 12,
      isPublic: false,
    });
    assert(r && r.item, brief(r));
    return `attack ${r.attackTotal}, damage ${r.damageTotal}`;
  });
}

// --- 6. Combat (a sweep combat of the wolf token) ------------------------------

async function combatTools() {
  let started = false;
  await step('set-up: a combat with the sweep token (test helper)', async () => {
    if (!ctx.wolfTokenId) skip('no sweep token on the scene');
    const r = await helper({ mode: 'combat', tokenIds: [ctx.wolfTokenId] });
    started = true;
    return `${r.combatId}: ${r.combatants.join(', ')}`;
  });
  const needCombat = () => {
    if (!started) skip('no sweep combat');
  };
  await step('roll-initiative-for-npcs (missing)', async () => {
    needCombat();
    const r = await tool('roll-initiative-for-npcs', { scope: 'missing' });
    assert(r && r.order && r.order.length >= 1, brief(r));
    return r.order.map(o => `${o.name} ${o.initiative}`).join(', ');
  });
  await step('set-initiative', async () => {
    needCombat();
    const r = await tool('set-initiative', { combatantName: ctx.wolfName, initiative: 17 });
    assert(r && Number(r.initiative) === 17, brief(r));
    return '17';
  });
  await step('advance-combat-turn (skip to the wolf)', async () => {
    needCombat();
    const r = await tool('advance-combat-turn', { skipTo: ctx.wolfName });
    assert(r && r.round >= 1, brief(r));
    return `round ${r.round}, turn ${r.turn}`;
  });
  await step('plan-token-change delete (with its combatant, undo restores both)', async () => {
    needCombat();
    const wolfCombatant = async () => {
      const state = await tool('get-combat-state', {});
      return ((state && state.combatants) || []).find(c => c.tokenId === ctx.wolfTokenId) || null;
    };
    const before = await wolfCombatant();
    assert(before, 'the sweep token is not in the combat');
    const { plan, change } = await planAndApply(
      { action: 'delete', tokens: [ctx.wolfTokenId] },
      'plan-token-change'
    );
    assert(plan.risk === 'destructive', `risk ${plan.risk}`);
    assert(!(await wolfToken()), 'the token is still on the scene');
    assert(!(await wolfCombatant()), 'the combatant is still in the combat');
    await undo(change);
    assert(await wolfToken(), 'the token did not come back');
    const after = await wolfCombatant();
    assert(after, 'the combatant did not come back');
    assert(
      after.initiative === before.initiative,
      `initiative ${after.initiative}, was ${before.initiative}`
    );
    return `${plan.targets[0].line}; undone (initiative ${after.initiative})`;
  });
}

// --- 7. Scene: notes, templates, mood, switching --------------------------------

async function sceneTools() {
  await step('add-map-note', async () => {
    const r = await tool('add-map-note', { text: `${PREFIX} note`, x: 200, y: 200 });
    ctx.noteId = r && r.noteId;
    assert(ctx.noteId, `no note id in ${brief(r)}`);
    return ctx.noteId;
  });
  await step('delete-map-note', async () => {
    if (!ctx.noteId) skip('no sweep note');
    const r = await tool('delete-map-note', { noteId: ctx.noteId });
    assert(r && r.deletedCount === 1, brief(r));
    ctx.noteId = null;
    return 'deleted';
  });
  await step('place-measured-template (circle)', async () => {
    const r = await tool('place-measured-template', {
      shape: 'circle',
      distance: 10,
      x: 300,
      y: 300,
    });
    ctx.templateId = r && r.templateId;
    assert(ctx.templateId, `no template id in ${brief(r)}`);
    return `${ctx.templateId}, ${(r.tokensInside || []).length} token(s) inside`;
  });
  await step('delete-measured-template', async () => {
    if (!ctx.templateId) skip('no sweep template');
    const r = await tool('delete-measured-template', { templateId: ctx.templateId });
    assert(r && r.deletedCount === 1, brief(r));
    ctx.templateId = null;
    return 'deleted';
  });
  await step('set-scene-mood (and back)', async () => {
    if (!ctx.mood || ctx.mood.darkness === null) skip('scene lighting unknown, left alone');
    const target = ctx.mood.darkness >= 0.5 ? 0.1 : 0.9;
    await tool('set-scene-mood', { darkness: target, globalLight: !ctx.mood.globalLight });
    const after = await helper({ mode: 'snapshot' });
    assert(Math.abs(after.darkness - target) < 0.01, `darkness ${after.darkness}`);
    await restoreMood();
    return `darkness ${ctx.mood.darkness} -> ${target} -> back`;
  });
  await step('switch-scene (and back)', async () => {
    const listed = await tool('list-scenes', {});
    const scenes = Array.isArray(listed) ? listed : (listed && listed.scenes) || [];
    const other = scenes.find(s => s.id !== ctx.scene.id);
    if (!other) skip('the world has only one scene');
    await tool('switch-scene', { scene_identifier: other.id });
    ctx.switchedScene = true;
    // A GM does not switch back within a second; give the canvas time to draw.
    await new Promise(resolve => setTimeout(resolve, 2500));
    await restoreScene();
    // The tools act on the scene the GM client views: it must follow the switch back.
    const now = await tool('get-current-scene', {});
    assert(now && now.id === ctx.scene.id, `the tools now see "${now && now.name}"`);
    return `${other.name} -> ${ctx.scene.name}`;
  });
}

async function restoreMood() {
  if (!ctx.mood || ctx.mood.darkness === null) return;
  await tool('set-scene-mood', {
    darkness: ctx.mood.darkness,
    ...(ctx.mood.globalLight === null ? {} : { globalLight: ctx.mood.globalLight }),
  });
}

async function restoreScene() {
  if (!ctx.switchedScene) return;
  await tool('switch-scene', { scene_identifier: ctx.scene.id });
  ctx.switchedScene = false;
}

// --- 8. Chat and roll requests ---------------------------------------------------

async function chatTools() {
  await step('send-chat-message (whisper to the GM)', async () => {
    const r = await tool('send-chat-message', {
      message: `${PREFIX}: test message (deleted at the end of the run)`,
      messageType: 'whisper',
      whisperTargets: ['Claude'],
    });
    assert(r && r.messageId, brief(r));
    return r.messageId;
  });
  const requests = [
    [
      'request-player-rolls',
      {
        rollType: 'skill',
        rollTarget: 'perception',
        targetPlayer: PLAYER,
        isPublic: false,
        userConfirmedVisibility: true,
      },
    ],
    ['request-ability-check', { targetPlayer: PLAYER, ability: 'wis', dc: 10, isPublic: false }],
    [
      'request-attack-roll',
      { targetPlayer: PLAYER, weaponOrSpellName: `${PREFIX} Longsword`, isPublic: false },
    ],
  ];
  for (const [name, args] of requests) {
    await step(`${name} (to ${PLAYER})`, async () => {
      try {
        return brief(await tool(name, args), 80);
      } catch (e) {
        if (/not (currently )?logged in|not connected|no .*user/i.test(e.message)) {
          skip(`${PLAYER} is not logged in (${brief(e.message, 80)})`);
        }
        throw e;
      }
    });
  }
}

// --- 9. Actor state on the sweep NPC ----------------------------------------------

async function actorTools() {
  const needNpc = () => {
    if (!ctx.npcId) skip('no sweep NPC');
  };
  await step('plan-actor-change resource (one use spent, undo)', async () => {
    needNpc();
    const read = async () => {
      const res = await tool('get-character-resources', { identifier: ctx.npcId });
      // get-character-resources lists slots as level1..level9 (and pact) with max/current;
      // plan-actor-change takes spell1..spell9 (level1..9 work too).
      const slots = Object.entries((res && res.spellSlots) || {}).map(([k, v]) => ({
        name: k.replace(/^level/, 'spell'),
        value: v && typeof v === 'object' ? (v.value ?? v.current) : v,
        max: v && typeof v === 'object' ? v.max : 0,
      }));
      const charges = ((res && res.itemCharges) || []).map(c => ({
        name: c.itemName,
        value: c.charges,
        max: c.max,
      }));
      return { res, all: [...slots, ...charges] };
    };
    const before = await read();
    const usable = before.all.filter(r => Number(r.max) > 0 && Number(r.value) > 0);
    if (usable.length === 0) {
      skip(
        `no resource with uses on the NPC: ${brief({ slots: before.res && before.res.spellSlots, charges: before.res && before.res.itemCharges }, 160)}`
      );
    }
    const { name } = usable[0];
    const old = Number(usable[0].value);
    const valueOf = async () => Number((await read()).all.find(r => r.name === name)?.value);
    const { change } = await planAndApply({
      action: 'resource',
      targets: [ctx.npcId],
      resource: name,
      value: old - 1,
    });
    const spent = await valueOf();
    assert(spent === old - 1, `${name} is ${spent} after the apply, expected ${old - 1}`);
    await undo(change);
    const back = await valueOf();
    assert(back === old, `${name} is ${back} after the undo, expected ${old}`);
    return `${name} ${old} -> ${spent} -> undone to ${back}`;
  });
  await step('drop-loot (1 gp to the NPC, no chat)', async () => {
    needNpc();
    const r = await tool('drop-loot', {
      targetCharacter: ctx.npcName,
      currency: { gp: 1 },
      announce: false,
    });
    return brief(r && (r.summary || r), 80);
  });
  await step('manage-rest (long, NPC)', async () => {
    needNpc();
    const r = await tool('manage-rest', { targets: [ctx.npcName], restType: 'long' });
    const row = r && r.results && r.results[0];
    assert(row && !row.error, brief(r));
    return `hp ${brief(row.hp, 40)}`;
  });
  await step(`assign-actor-ownership (NPC to ${PLAYER}, observer)`, async () => {
    needNpc();
    const r = await tool('assign-actor-ownership', {
      actorIdentifier: ctx.npcId,
      playerIdentifier: PLAYER,
      permissionLevel: 'OBSERVER',
    });
    assert(r && r.success !== false, brief(r));
    const listed = await tool('list-actor-ownership', { actorIdentifier: ctx.npcId });
    assert(JSON.stringify(listed).includes(PLAYER), `not listed: ${brief(listed)}`);
    return 'assigned and listed';
  });
  await step(`remove-actor-ownership (NPC from ${PLAYER})`, async () => {
    needNpc();
    const r = await tool('remove-actor-ownership', {
      actorIdentifier: ctx.npcId,
      playerIdentifier: PLAYER,
      confirmRemoval: true,
    });
    assert(r && r.success !== false, brief(r));
    return 'removed';
  });
  await step('use-item (opens a dialog in the GM browser)', async () => {
    if (!WITH_DIALOGS) skip('needs a click in the GM browser; run with --with-dialogs');
    if (!ctx.wolfActorId) skip('no sweep wolf');
    const r = await tool('use-item', {
      actorIdentifier: ctx.wolfActorId,
      itemIdentifier: 'Bite',
      consume: false,
    });
    return brief(r, 80);
  });
}

// --- 10. Session log and diagnostics -------------------------------------------------

async function logTools() {
  await step('mark-play-session (start, end)', async () => {
    await tool('mark-play-session', { action: 'start', note: `${PREFIX} run` });
    const r = await tool('mark-play-session', { action: 'end', note: `${PREFIX} run` });
    assert(r && r.action === 'end', brief(r));
    return `${r.worldId} ${r.markedAt}`;
  });
  await step('clear-module-errors (last)', async () => {
    const errors = await tool('get-module-errors', {});
    const r = await tool('clear-module-errors', {});
    assert(r && typeof r.cleared === 'number', brief(r));
    return `cleared ${r.cleared} (were: ${brief(errors, 60)})`;
  });
}

// --- 11. Clean-up -------------------------------------------------------------------

async function cleanUp() {
  const quiet = p => p.catch(e => console.log(`  note: clean-up step failed: ${e.message}`));
  await step('clean up: scene put back, sweep token and documents deleted', async () => {
    if (ctx.noteId) await quiet(tool('delete-map-note', { noteId: ctx.noteId }));
    if (ctx.templateId)
      await quiet(tool('delete-measured-template', { templateId: ctx.templateId }));
    await quiet(restoreScene());
    await quiet(restoreMood());
    // The module also deletes sweep tokens on any scene, whichever scene the GM views.
    const r = await helper({ mode: 'cleanup', since: ctx.since });
    const deleted = Object.entries(r.deleted || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    return deleted || 'nothing left';
  });
  if (ctx.scene) {
    await step('the GM client views the scene it started on', async () => {
      const now = await tool('get-current-scene', {});
      assert(now && now.id === ctx.scene.id, `it views "${now && now.name}"`);
      return ctx.scene.name;
    });
  }
  if (ctx.gmActionsBefore !== null) {
    await step('GM Actions back to their previous state', async () => {
      await setGmActions(ctx.gmActionsBefore);
      return ctx.gmActionsBefore ? 'on' : 'off';
    });
  }
}

// --- Main -----------------------------------------------------------------------------

async function main() {
  console.log(`# Live write sweep against ${BASE} (test world ${EXPECTED_WORLD})`);
  try {
    await step('dashboard, bridge and Foundry reachable; world is ai-tool-test', checkEnvironment);
  } catch (e) {
    if (!(e instanceof EnvError)) throw e;
    console.log(`\nENVIRONMENT NOT READY: ${e.message}`);
    console.log('Start it with: pwsh scripts/test-env/start.ps1, then join the world as "Claude".');
    process.exit(EXIT_ENV);
  }
  let envError = null;
  try {
    await setUp();
    await buildTools();
    await itemAndJournalTools();
    await tokenTools();
    await combatTools();
    await sceneTools();
    await chatTools();
    await actorTools();
    await logTools();
  } catch (e) {
    if (!(e instanceof EnvError)) throw e;
    envError = e;
  } finally {
    try {
      await cleanUp();
    } catch (e) {
      console.log(`FAIL clean-up: ${e.message}`);
      counts.fail += 1;
    }
  }
  console.log(
    `\nRESULT: ${counts.pass} passed, ${counts.skip} skipped, ${counts.fail} failed` +
      (envError ? ` (stopped early: ${envError.message})` : '')
  );
  if (envError) process.exit(EXIT_ENV);
  process.exit(counts.fail > 0 ? EXIT_FAIL : 0);
}

main().catch(e => {
  console.error(`UNEXPECTED: ${e && e.stack ? e.stack : e}`);
  process.exit(EXIT_FAIL);
});
