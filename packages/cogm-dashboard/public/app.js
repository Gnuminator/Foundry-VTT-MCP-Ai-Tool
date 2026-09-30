// Co-GM dashboard client. Vanilla ES module — no build step.
// Connects to the server's SSE stream and renders three live panes plus the
// "ask the co-GM" control. All mutations go through the server's REST endpoints.

// --- GM auth token (Phase 6 player/GM split) -------------------------------
// Legacy/single-user mode needs no token. When the server-side split is enabled,
// open this GM page once with ?token=<GM_DASHBOARD_TOKEN>; we persist it so
// refreshes keep working. Sent as a header on REST calls and as a query param on
// the EventSource (which cannot set headers). The server enforces the role — this
// only forwards the credential.
const COGM_TOKEN = (() => {
  const fromUrl = new URL(location.href).searchParams.get('token');
  if (fromUrl) {
    try {
      localStorage.setItem('cogm_token', fromUrl);
    } catch {}
    return fromUrl;
  }
  try {
    return localStorage.getItem('cogm_token') || '';
  } catch {
    return '';
  }
})();
const authHeaders = () => (COGM_TOKEN ? { 'X-CoGM-Token': COGM_TOKEN } : {});
const streamUrl = () =>
  '/api/stream' + (COGM_TOKEN ? '?token=' + encodeURIComponent(COGM_TOKEN) : '');

const $ = id => document.getElementById(id);

// Usage log (I-084, usage.js): fixed control names only, never typed text or messages. The
// page works the same when usage.js is missing.
const noop = () => {};
const usage = window.cogmUsage || {
  track: noop,
  trackTool: noop,
  trackView: noop,
  endView: noop,
  trackShortcut: noop,
};

const els = {
  worldSubtitle: $('world-subtitle'),
  statusBridge: $('status-bridge'),
  statusFoundry: $('status-foundry'),
  statusAi: $('status-ai'),
  linkBanner: $('link-banner'),
  btnPause: $('btn-pause'),
  btnDiag: $('btn-diag'),
  selectTone: $('select-tone'),
  selectModel: $('select-model'),
  combatMeta: $('combat-meta'),
  combatBody: $('combat-body'),
  feedMeta: $('feed-meta'),
  feedBody: $('feed-body'),
  aiMeta: $('ai-meta'),
  aiBody: $('ai-body'),
  diagMeta: $('diag-meta'),
  diagBody: $('diag-body'),
  askForm: $('ask-form'),
  askInput: $('ask-input'),
  // GM Actions
  btnGm: $('btn-gm'),
  btnTools: $('btn-tools'),
  combatActions: $('combat-actions'),
  bossToggle: $('boss-toggle'),
  bossPrompts: $('boss-prompts'),
  drawer: $('tools-drawer'),
  drawerBackdrop: $('drawer-backdrop'),
  drawerClose: $('drawer-close'),
  gmGate: $('gm-gate'),
  gmGateEnable: $('gm-gate-enable'),
  toolSearch: $('tool-search'),
  toolList: $('tool-list'),
  toolBrowser: $('tool-browser'),
  toolDetail: $('tool-detail'),
  toolBack: $('tool-back'),
  toolDetailName: $('tool-detail-name'),
  toolDetailKind: $('tool-detail-kind'),
  toolDetailDesc: $('tool-detail-desc'),
  toolForm: $('tool-form'),
  toolResult: $('tool-result'),
  modalBackdrop: $('modal-backdrop'),
  modalTitle: $('modal-title'),
  modalBody: $('modal-body'),
  modalDestructive: $('modal-destructive'),
  modalDestructiveCheck: $('modal-destructive-check'),
  modalCancel: $('modal-cancel'),
  modalConfirm: $('modal-confirm'),
  toastStack: $('toast-stack'),
  // Tarokka drawer
  btnTarokka: $('btn-tarokka'),
  tarokkaDrawer: $('tarokka-drawer'),
  tarokkaClose: $('tarokka-close'),
  tarokkaSub: $('tarokka-sub'),
  tarokkaBody: $('tarokka-body'),
  tarokkaRefresh: $('tarokka-refresh'),
  tarokkaImport: $('tarokka-import'),
  tarokkaRoll: $('tarokka-roll'),
  tarokkaShow: $('tarokka-show'),
  // Handouts drawer (I-039)
  btnHandouts: $('btn-handouts'),
  handoutsDrawer: $('handouts-drawer'),
  handoutsClose: $('handouts-close'),
  handoutsSub: $('handouts-sub'),
  handoutsNext: $('handouts-next'),
  handoutsAdd: $('handouts-add'),
  handoutsRefresh: $('handouts-refresh'),
  handoutsQueue: $('handouts-queue'),
  handoutsRevealed: $('handouts-revealed'),
  // Pre-flight drawer
  btnPreflight: $('btn-preflight'),
  preflightDrawer: $('preflight-drawer'),
  preflightClose: $('preflight-close'),
  preflightSub: $('preflight-sub'),
  preflightRun: $('preflight-run'),
  preflightClear: $('preflight-clear'),
  preflightSummary: $('preflight-summary'),
  preflightAuto: $('preflight-auto'),
  preflightFindings: $('preflight-findings'),
  preflightManual: $('preflight-manual'),
  versionBanner: $('version-banner'),
  // Prep drawer (I-045)
  btnPrep: $('btn-prep'),
  prepDrawer: $('prep-drawer'),
  prepClose: $('prep-close'),
  prepSub: $('prep-sub'),
  prepRefresh: $('prep-refresh'),
  prepWarnings: $('prep-warnings'),
  prepLast: $('prep-last'),
  prepThreads: $('prep-threads'),
  prepNotes: $('prep-notes'),
  prepReady: $('prep-ready'),
  prepChanges: $('prep-changes'),
  prepTarokka: $('prep-tarokka'),
  // Party drawer (I-079)
  btnParty: $('btn-party'),
  partyDrawer: $('party-drawer'),
  partyClose: $('party-close'),
  partySub: $('party-sub'),
  partyRefresh: $('party-refresh'),
  partyGroup: $('party-group'),
  partyWarnings: $('party-warnings'),
  partyMembers: $('party-members'),
  partyActions: $('party-actions'),
  partyPace: $('party-pace'),
  partyCombat: $('party-combat'),
  partyRest: $('party-rest'),
  // Recent guarded changes
  changesBody: $('changes-body'),
  changesMeta: $('changes-meta'),
  changesRefresh: $('changes-refresh'),
  // Play session control (O2)
  sessionStatus: $('session-status'),
  btnSession: $('btn-session'),
  sessionObsidian: $('session-obsidian'),
  tarokkaObsidian: $('tarokka-obsidian'),
};

const seenEventIds = new Set();
let eventCount = 0;
const seenErrorIds = new Set();
const errorCounts = { error: 0, warn: 0 };
const comments = new Map(); // genId -> { card, body, doneText }
let settings = {
  paused: false,
  tone: 'tactical',
  model: 'claude-opus-4-8',
  aiEnabled: false,
  commentOnErrors: true,
  gmActionsEnabled: false,
  // GM-only; null until the "settings" snapshot arrives, or when Obsidian links are off.
  obsidian: null,
};

// GM Actions state
let lastCombat = null;
const selectedCombatants = new Set();
let toolCatalog = [];
let toolsLoaded = false;
let confirmResolver = null;
let recentChanges = [];
let tarokkaView = null;
let changesReloadTimer = null;

// Play session control (O2)
let currentWorldId = null;
let playSession = { open: false, startedAt: null };

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------
async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : Promise.reject(new Error(`${path} -> ${res.status}`));
}

/**
 * Post AI text to Foundry chat as a GM whisper. The server refuses (409) text
 * that names a GM secret, because a whisper reaches every player's client (only
 * its display is hidden); the GM can then post anyway. Resolves true when posted,
 * false when the GM chose not to.
 */
async function postChat(text) {
  const send = allowSecrets =>
    fetch('/api/post-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(allowSecrets ? { text, allowSecrets: true } : { text }),
    });
  let res = await send(false);
  if (res.status === 409) {
    const info = await res.json().catch(() => ({}));
    const terms = (info.matches || []).map(m => `${m.term} (${m.category})`).join(', ');
    const ok = window.confirm(
      `This text names GM secrets: ${terms || 'unknown'}.\n\n` +
        "A whisper reaches every player's browser; only its display is hidden. Post anyway?"
    );
    if (!ok) return false;
    res = await send(true);
  }
  if (!res.ok) throw new Error(`/api/post-chat -> ${res.status}`);
  return true;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function setDot(pill, cls, label) {
  pill.innerHTML = `<span class="dot ${cls}"></span> ${label}`;
}

// Banner: Foundry has not been connected to the bridge for a while (PB-03).
const LINK_BANNER_AFTER_MS = 2 * 60 * 1000;
let lastStatus = null;
function renderLinkBanner() {
  const s = lastStatus;
  const since =
    s && s.foundry === 'unreachable' && s.foundryDownSince ? Date.parse(s.foundryDownSince) : NaN;
  if (Number.isNaN(since) || Date.now() - since < LINK_BANNER_AFTER_MS) {
    els.linkBanner.hidden = true;
    return;
  }
  const hhmm = new Date(since).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  els.linkBanner.textContent = `Foundry is not connected to the bridge since ${hhmm}. Open Foundry in the bridge user's browser, or reload that tab.`;
  els.linkBanner.hidden = false;
}
// Re-check on a timer too, so the banner appears without a new status event.
setInterval(renderLinkBanner, 15000);

let foundryLive = false;
function renderStatus(status) {
  lastStatus = status;
  renderLinkBanner();
  if (status.controlChannel === 'connected') {
    setDot(els.statusBridge, 'dot-green', 'Bridge: connected');
  } else {
    setDot(els.statusBridge, 'dot-red', 'Bridge: disconnected');
  }

  if (status.foundry === 'reachable') {
    setDot(els.statusFoundry, 'dot-green', 'Foundry: live');
    if (!foundryLive) {
      scheduleChangesReload();
      // A quiet run on every (re)connect keeps the header button and the version banner current.
      void runPreflight({ quiet: true });
    }
  } else if (status.foundry === 'unreachable') {
    setDot(els.statusFoundry, 'dot-amber', 'Foundry: unreachable');
  } else {
    setDot(els.statusFoundry, 'dot-grey', 'Foundry: unknown');
  }
  foundryLive = status.foundry === 'reachable';
}

function renderSettings(next) {
  settings = { ...settings, ...next };
  els.btnPause.textContent = settings.paused ? '▶ Resume' : '⏸ Pause';
  els.btnPause.classList.toggle('paused', settings.paused);
  els.selectTone.value = settings.tone;
  if (settings.model) els.selectModel.value = settings.model;
  els.btnDiag.textContent = settings.commentOnErrors ? '🩺 Diag AI: on' : '🩺 Diag AI: off';
  els.btnDiag.classList.toggle('toggle-off', !settings.commentOnErrors);
  if (settings.aiEnabled) {
    setDot(els.statusAi, 'dot-green', `AI: ${settings.paused ? 'paused' : 'on'}`);
    els.btnPause.disabled = false;
    els.btnDiag.disabled = false;
  } else {
    setDot(els.statusAi, 'dot-red', 'AI: disabled');
    els.btnPause.disabled = true;
    els.btnDiag.disabled = true;
    els.askInput.placeholder = 'Set ANTHROPIC_API_KEY to enable the co-GM';
  }

  // GM Actions master switch
  els.btnGm.textContent = settings.gmActionsEnabled ? '⚔ GM Actions: on' : '⚔ GM Actions: off';
  els.btnGm.classList.toggle('on', !!settings.gmActionsEnabled);
  if (!settings.gmActionsEnabled) selectedCombatants.clear();
  updateGate();
  renderCombat(lastCombat);
  renderObsidianLinks();
}

function renderWorld(world) {
  currentWorldId = world && world.id ? world.id : null;
  renderObsidianLinks();
  if (!world) return;
  els.worldSubtitle.textContent = `${world.title} · ${world.systemId} ${world.systemVersion} · Foundry ${world.foundryVersion}`;
}

// ---------------------------------------------------------------------------
// Open in Obsidian (GM only; O2): links only render once both the vault name
// (from the GM-only "settings" payload) and the world id (from "world") are
// known; no link while the world id is unknown.
// ---------------------------------------------------------------------------
function obsidianFileUrl(relativePath) {
  const vault = settings.obsidian && settings.obsidian.vault;
  if (!vault || !currentWorldId) return null;
  const file = `Campaigns/${currentWorldId}/${relativePath}`;
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}

function setObsidianLink(el, url) {
  if (!el) return;
  el.hidden = !url;
  if (url) el.href = url;
}

function renderObsidianLinks() {
  setObsidianLink(els.sessionObsidian, obsidianFileUrl('Home'));
  setObsidianLink(els.tarokkaObsidian, obsidianFileUrl('AI Tool/Tarokka/Current reading'));
  // Recent Changes links are per row (each month is its own note): see renderRecentChanges.
}

// ---------------------------------------------------------------------------
// Play session control (O2). Marks the bridge's own session log for the
// renderer's session grouping; never touches game state, so it is gated like a
// read (no GM Actions switch, no confirm; see tool-policy.ts LOG_ONLY_TOOLS).
// ---------------------------------------------------------------------------
function renderSessionControl() {
  if (playSession.open) {
    const time = playSession.startedAt
      ? new Date(playSession.startedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
    els.sessionStatus.textContent = time ? `Session since ${time}` : 'Session active';
    els.btnSession.textContent = 'End session';
  } else {
    els.sessionStatus.textContent = 'No session';
    els.btnSession.textContent = 'Start session';
  }
}

async function loadPlaySession({ quiet = true } = {}) {
  try {
    const result = await callReadTool('get-play-session', {});
    playSession = {
      open: !!(result && result.open),
      startedAt: (result && result.startedAt) || null,
    };
    renderSessionControl();
  } catch (err) {
    // Polls stay quiet (Foundry may simply be offline); a click reports the error.
    els.sessionStatus.textContent = 'Session: unknown';
    if (!quiet) toast(`✗ get-play-session: ${String(err.message || err)}`, 'err');
  }
}

async function markSession(action) {
  try {
    await callReadTool('mark-play-session', { action });
    toast(action === 'start' ? '✓ Play session started' : '✓ Play session ended', 'ok');
  } catch (err) {
    toast(`✗ mark-play-session: ${String(err.message || err)}`, 'err');
  }
  await loadPlaySession({ quiet: false });
}

// ---------------------------------------------------------------------------
// Combat tracker
// ---------------------------------------------------------------------------
function sideTag(c) {
  if (c.isPC) return '<span class="side side-pc">PC</span>';
  if (c.category === 'enemy') return '<span class="side side-enemy">Enemy</span>';
  return '<span class="side side-npc">NPC</span>';
}

function hpClass(ratio) {
  if (ratio <= 0.33) return 'low';
  if (ratio <= 0.66) return 'mid';
  return '';
}

function combatantClasses(c) {
  const cls = ['combatant'];
  if (c.isCurrentTurn) cls.push('current');
  if (c.defeated) cls.push('defeated');
  if (settings.gmActionsEnabled) cls.push('selectable');
  if (selectedCombatants.has(c.id)) cls.push('selected');
  return cls.join(' ');
}

// --- Boss prompts (I-070): legendary pips, lair reminder, reaction ticks ---
// Read-only: the pips come from the actor's dnd5e data in get-combat-state;
// reaction ticks live in this browser and reset each round. Off by default
// (D-081: switch it on before the first boss fight); remembered per browser.
const BOSS_PROMPTS_KEY = 'cogm_boss_prompts';
let bossPrompts = (() => {
  try {
    return localStorage.getItem(BOSS_PROMPTS_KEY) === 'on';
  } catch {
    return false;
  }
})();
const reactionsUsed = new Set();
let reactionsRound = null;

function setBossPrompts(on) {
  bossPrompts = on;
  try {
    localStorage.setItem(BOSS_PROMPTS_KEY, on ? 'on' : 'off');
  } catch {}
  renderCombat(lastCombat);
}
function pips(counter, cls) {
  const filled = '◆'.repeat(counter.remaining);
  const empty = '◇'.repeat(Math.max(0, counter.max - counter.remaining));
  return `<span class="boss-pips ${cls}">${filled}${empty}</span> ${counter.remaining}/${counter.max}`;
}
function bossLine(c) {
  const b = c.boss;
  if (!bossPrompts || !b) return '';
  const parts = [];
  if (b.legendary) parts.push(`Legendary ${pips(b.legendary, 'pips-legendary')}`);
  if (b.resistances) parts.push(`Resist ${pips(b.resistances, 'pips-resist')}`);
  if (b.lair) parts.push(b.lair.inside ? '🏰 in lair' : '🏰 lair');
  return parts.length ? `<div class="boss-line">${parts.join(' · ')}</div>` : '';
}
function reactionButton(c) {
  if (!bossPrompts || c.defeated) return '';
  const used = reactionsUsed.has(c.id);
  return `<button type="button" class="reaction-btn${used ? ' used' : ''}" data-track="dash.combat.reaction" data-reaction="${escapeHtml(c.id)}" title="${used ? 'Reaction used this round (click to undo)' : 'Mark reaction used this round'}">R</button>`;
}
/** The combatant whose turn the lair action comes before: the first below the lair's count. */
function lairTurnIndex(combatants, count) {
  const idx = combatants.findIndex(c => typeof c.initiative !== 'number' || c.initiative < count);
  return idx === -1 ? 0 : idx;
}
function renderBossPrompts(combat) {
  const active = !!(combat && combat.active);
  const bosses = active ? combat.combatants.filter(c => c.boss && !c.defeated) : [];
  els.bossToggle.hidden = bosses.length === 0;
  els.bossToggle.textContent = bossPrompts ? '👑 Boss prompts: on' : '👑 Boss prompts: off';
  els.bossToggle.classList.toggle('on', bossPrompts);
  if (!bossPrompts || bosses.length === 0) {
    els.bossPrompts.hidden = true;
    els.bossPrompts.innerHTML = '';
    return;
  }
  const lines = [];
  const current = combat.combatants[combat.turn] || combat.current || null;
  for (const b of bosses) {
    const lair = b.boss.lair;
    if (lair && (lair.inside || typeof lair.initiative === 'number')) {
      const count = typeof lair.initiative === 'number' ? lair.initiative : 20;
      if (combat.turn === lairTurnIndex(combat.combatants, count)) {
        lines.push(
          `<div class="boss-prompt prompt-lair">🏰 Lair action for ${escapeHtml(b.name)} (initiative ${count}), before ${escapeHtml(current ? current.name : 'this turn')}'s turn.</div>`
        );
      }
    }
  }
  for (const b of bosses) {
    const leg = b.boss.legendary;
    if (!leg || leg.remaining <= 0 || (current && current.id === b.id)) continue;
    lines.push(
      `<div class="boss-prompt prompt-legendary">⚡ ${escapeHtml(b.name)}: ${leg.remaining} legendary action${leg.remaining === 1 ? '' : 's'} left, one after this turn.</div>`
    );
  }
  els.bossPrompts.hidden = lines.length === 0;
  els.bossPrompts.innerHTML = lines.join('');
}

function renderCombat(combat) {
  lastCombat = combat;
  renderBossPrompts(combat);
  if (!combat || !combat.active) {
    selectedCombatants.clear();
    els.combatMeta.textContent = '—';
    els.combatBody.innerHTML = '<p class="empty">No active combat.</p>';
    renderCombatActions();
    return;
  }

  // Drop selections for combatants that have left the encounter.
  const ids = new Set(combat.combatants.map(c => c.id));
  for (const id of [...selectedCombatants]) if (!ids.has(id)) selectedCombatants.delete(id);

  els.combatMeta.textContent = `Round ${combat.round} · ${combat.combatants.length} combatants`;
  if (reactionsRound !== combat.round) {
    reactionsUsed.clear();
    reactionsRound = combat.round;
  }

  const rows = combat.combatants
    .map(c => {
      const ratio = c.hp.max > 0 ? c.hp.value / c.hp.max : 0;
      const conditions = (c.conditions || [])
        .map(cond => `<span class="condition-chip">${escapeHtml(cond)}</span>`)
        .join('');
      const deathSaves =
        c.deathSaves && c.hp.value <= 0
          ? `<div class="death-saves">Death saves ✓${c.deathSaves.successes} ✗${c.deathSaves.failures}</div>`
          : '';
      const init = c.initiative === null || c.initiative === undefined ? '—' : c.initiative;
      return `
        <div class="${combatantClasses(c)}"${settings.gmActionsEnabled ? ' data-track="dash.combat.select-combatant"' : ''} data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">
          <div class="init-badge">${init}</div>
          <div class="combatant-main">
            <div class="combatant-name">${escapeHtml(c.name)} ${sideTag(c)} ${reactionButton(c)}</div>
            ${bossLine(c)}
            ${conditions ? `<div class="conditions">${conditions}</div>` : ''}
            ${deathSaves}
          </div>
          <div class="hp">
            <div class="hp-text">${c.hp.value}/${c.hp.max}${c.hp.temp ? ` +${c.hp.temp}` : ''}</div>
            <div class="hp-bar"><div class="hp-fill ${hpClass(ratio)}" style="width:${Math.max(0, Math.min(100, ratio * 100))}%"></div></div>
          </div>
        </div>`;
    })
    .join('');
  els.combatBody.innerHTML = rows;
  renderCombatActions();
}

function selectedNames() {
  if (!lastCombat || !lastCombat.combatants) return [];
  return lastCombat.combatants.filter(c => selectedCombatants.has(c.id)).map(c => c.name);
}

function renderCombatActions() {
  const active = !!(lastCombat && lastCombat.active);
  if (!active || !settings.gmActionsEnabled) {
    els.combatActions.hidden = true;
    els.combatActions.innerHTML = '';
    return;
  }
  els.combatActions.hidden = false;
  const n = selectedCombatants.size;
  els.combatActions.innerHTML = `
    <div class="ca-row">
      <div class="ca-seg" role="group" aria-label="Roll initiative">
        <span class="ca-seg-label">Init</span>
        <button type="button" class="ca-btn" data-track="dash.combat.init-npcs" data-init="npcs">NPCs</button>
        <button type="button" class="ca-btn" data-track="dash.combat.init-all" data-init="all">All</button>
        <button type="button" class="ca-btn" data-track="dash.combat.init-missing" data-init="missing">Missing</button>
      </div>
      <button type="button" class="ca-btn" data-track="dash.combat.advance-turn" data-advance>⏭ Advance turn</button>
    </div>${
      n > 0
        ? `
    <div class="ca-row ca-selection">
      <span class="ca-count"><strong>${n}</strong> selected</span>
      <button type="button" class="ca-btn" data-track="dash.combat.selection-init" data-sel="init">Roll init</button>
      <button type="button" class="ca-btn" data-track="dash.combat.selection-damage" data-sel="damage">Damage / Heal</button>
      <button type="button" class="ca-btn" data-track="dash.combat.selection-save" data-sel="save">Roll save</button>
      <button type="button" class="ca-btn ghost" data-track="dash.combat.selection-clear" data-sel="clear">Clear</button>
    </div>`
        : ''
    }`;
}

// ---------------------------------------------------------------------------
// Event feed (newest on top)
// ---------------------------------------------------------------------------

/** A roll event's full breakdown for the GM, else the event's own description. */
function gmEventText(ev) {
  const breakdown = ev.details && ev.details.breakdown;
  return typeof breakdown === 'string' && breakdown ? breakdown : ev.description;
}

function addEvents(events) {
  if (!events || events.length === 0) return;
  if (els.feedBody.querySelector('.empty')) els.feedBody.innerHTML = '';

  // events arrive oldest-first; prepend each so newest ends up on top.
  // The GM sees a roll's full breakdown (target AC/DC and outcome included).
  for (const ev of events) {
    if (seenEventIds.has(ev.id)) continue;
    seenEventIds.add(ev.id);
    eventCount += 1;

    const time = new Date(ev.timestampMs).toLocaleTimeString();
    const node = document.createElement('div');
    node.className = `event sev-${ev.eventType}`;
    node.innerHTML = `
      <div class="event-desc">${escapeHtml(gmEventText(ev))}</div>
      <div class="event-meta">
        <span class="event-type">${escapeHtml(ev.eventType)}</span>
        <span>${time}</span>
      </div>`;
    els.feedBody.insertBefore(node, els.feedBody.firstChild);
    if (ev.eventType === 'gm-change') scheduleChangesReload();
  }

  // Cap DOM size.
  while (els.feedBody.children.length > 120) {
    els.feedBody.removeChild(els.feedBody.lastChild);
  }
  els.feedMeta.textContent = `${eventCount} events`;
}

// ---------------------------------------------------------------------------
// Module diagnostics (newest on top)
// ---------------------------------------------------------------------------
function addErrors(errors) {
  if (!errors || errors.length === 0) return;
  if (els.diagBody.querySelector('.empty')) els.diagBody.innerHTML = '';

  for (const er of errors) {
    if (seenErrorIds.has(er.id)) continue;
    seenErrorIds.add(er.id);
    if (er.level === 'warn') errorCounts.warn += 1;
    else errorCounts.error += 1;

    const time = new Date(er.timestampMs).toLocaleTimeString();
    const mod = (er.module || '').replace(/^(module|system|world):/, '') || 'unknown';
    const node = document.createElement('div');
    node.className = `diag-entry lvl-${er.level === 'warn' ? 'warn' : 'error'}`;
    node.title = er.message + (er.stack ? `\n\n${er.stack}` : '');
    node.innerHTML = `
      <span class="diag-level">${er.level === 'warn' ? 'warn' : 'error'}</span>
      <span class="diag-module">${escapeHtml(mod)}</span>
      <span class="diag-msg">${escapeHtml(er.message)}</span>
      <span class="diag-time">${time}</span>`;
    els.diagBody.insertBefore(node, els.diagBody.firstChild);
  }

  while (els.diagBody.children.length > 150) {
    els.diagBody.removeChild(els.diagBody.lastChild);
  }
  els.diagMeta.textContent = `${errorCounts.error} errors · ${errorCounts.warn} warns`;
}

// ---------------------------------------------------------------------------
// AI commentary
// ---------------------------------------------------------------------------
function commentStart(d) {
  if (els.aiBody.querySelector('.empty')) els.aiBody.innerHTML = '';
  const kindLabel = d.kind === 'ask' ? 'Ask' : d.kind === 'diagnostic' ? 'Diag' : 'Auto';
  const badgeClass = d.kind === 'ask' ? 'ask' : d.kind === 'diagnostic' ? 'diagnostic' : '';
  const card = document.createElement('div');
  card.className = `comment kind-${d.kind}`;
  card.innerHTML = `
    <div class="comment-head">
      <span class="comment-badge ${badgeClass}">${kindLabel} · ${escapeHtml(d.tone || '')}</span>
      <span class="comment-trigger">${escapeHtml(d.trigger || '')}</span>
    </div>
    <div class="comment-body"><span class="cursor">&nbsp;</span></div>
    <div class="comment-foot"></div>`;
  els.aiBody.insertBefore(card, els.aiBody.firstChild);
  comments.set(d.id, { card, body: card.querySelector('.comment-body'), text: '' });
}

function commentDelta(d) {
  const c = comments.get(d.id);
  if (!c) return;
  c.text += d.text;
  c.body.innerHTML = `${escapeHtml(c.text)}<span class="cursor">&nbsp;</span>`;
}

function commentDone(d) {
  const c = comments.get(d.id);
  if (!c) return;
  c.text = d.text || c.text;
  c.body.textContent = c.text;

  const foot = c.card.querySelector('.comment-foot');
  const u = d.usage || {};
  const cache = u.cacheHit
    ? `<span class="hit">cache ✓</span> ${u.cacheReadTokens} read`
    : 'cache miss';
  foot.innerHTML = `<span class="usage-chip">${cache} · ${u.outputTokens || 0} out</span>`;

  const postBtn = document.createElement('button');
  postBtn.className = 'btn btn-post';
  postBtn.textContent = '→ Post to chat';
  postBtn.addEventListener('click', () => {
    usage.track('action', 'dash.ai.post-to-chat');
    postBtn.disabled = true;
    postBtn.textContent = 'Posting…';
    postChat(c.text)
      .then(posted => {
        if (posted) {
          postBtn.textContent = '✓ Whispered to GM';
        } else {
          postBtn.disabled = false;
          postBtn.textContent = '→ Post to chat';
        }
      })
      .catch(() => {
        postBtn.disabled = false;
        postBtn.textContent = '⚠ Retry post';
      });
  });
  foot.appendChild(postBtn);
}

function commentError(d) {
  const c = comments.get(d.id);
  if (!c) return;
  usage.track('error', 'dash.ai.error', { code: 'generation' });
  c.card.classList.add('errored');
  c.body.textContent = `⚠ ${d.message || 'generation failed'}`;
}

function commentAborted(d) {
  const c = comments.get(d.id);
  if (!c) return;
  // Superseded by a newer generation; drop the cursor, leave any partial text.
  const cursor = c.body.querySelector('.cursor');
  if (cursor) cursor.remove();
  if (!c.text) c.card.remove();
}

// ---------------------------------------------------------------------------
// SSE wiring
// ---------------------------------------------------------------------------
function connect() {
  const es = new EventSource(streamUrl());
  const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));

  on('status', renderStatus);
  on('settings', renderSettings);
  on('world', renderWorld);
  on('combat', d => renderCombat(d.combat));
  on('events', d => addEvents(d.events));
  on('errors', d => addErrors(d.errors));
  on('handouts-seen', () => {
    if (!els.handoutsDrawer.hidden) void loadHandouts();
  });
  on('comment.start', commentStart);
  on('comment.delta', commentDelta);
  on('comment.done', commentDone);
  on('comment.error', commentError);
  on('comment.aborted', commentAborted);

  es.onerror = () => {
    setDot(els.statusBridge, 'dot-red', 'Bridge: reconnecting…');
  };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
els.btnPause.addEventListener('click', () => {
  postJson('/api/control', { action: 'toggle-pause' }).catch(() => {});
});
els.btnDiag.addEventListener('click', () => {
  postJson('/api/control', { action: 'toggle-diag' }).catch(() => {});
});
els.selectTone.addEventListener('change', () => {
  postJson('/api/control', { action: 'set-tone', value: els.selectTone.value }).catch(() => {});
});
els.selectModel.addEventListener('change', () => {
  postJson('/api/control', { action: 'set-model', value: els.selectModel.value }).catch(() => {});
});
els.askForm.addEventListener('submit', e => {
  e.preventDefault();
  const question = els.askInput.value.trim();
  if (!question) return;
  els.askInput.value = '';
  postJson('/api/ask', { question }).catch(err => {
    commentStart({ id: 'err', kind: 'ask', tone: settings.tone, trigger: question });
    commentError({ id: 'err', message: String(err.message || err) });
  });
});

// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// GM Actions — tool runner drawer, confirm modal, toasts
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  [/(planned-change|recent-changes|undo-change|open-in-foundry)/, 'Guarded changes'],
  [/(initiative|combat|turn)/, 'Combat'],
  [/(damage|heal|saving|ability|attack|roll|check|rest|activity|condition|effect)/, 'Resolution'],
  [/(token|move|template|vision|light|map-note)/, 'Tokens & Scene'],
  [/(scene|map|mood)/, 'Scenes & Maps'],
  [/(actor|npc|character|feature|archetype|ownership)/, 'Actors'],
  [/(item|loot|resource)/, 'Items & Loot'],
  [/(quest|journal|campaign)/, 'Journals & Quests'],
  [/(compendium|creature)/, 'Compendium'],
];
function categoryOf(name) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat;
  return 'World & Info';
}
function findTool(name) {
  return toolCatalog.find(t => t.name === name);
}

// A short code for an error toast: an HTTP status or a timeout, read from the message but
// never sent on (the message itself is never logged).
function toastCode(msg) {
  const http = /(?:HTTP|->) (\d{3})\b/.exec(msg);
  if (http) return http[1];
  return /time(?:d)? ?out/i.test(msg) ? 'timeout' : 'error';
}

function toast(msg, kind = 'ok', code) {
  if (kind === 'err') usage.track('error', 'dash.toast.error', { code: code || toastCode(msg) });
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  els.toastStack.appendChild(el);
  setTimeout(
    () => {
      el.style.transition = 'opacity .3s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    },
    kind === 'err' ? 6000 : 3500
  );
}

// --- Confirm modal (promise-based) ---
function confirmAction({ title, name, args, destructive, diff, summary }) {
  els.modalTitle.textContent = title;
  if (Array.isArray(diff)) {
    // A planned change: show what it will do, not the raw arguments.
    const lines = diff.length
      ? diff.map(line => `<li>${escapeHtml(line)}</li>`).join('')
      : '<li>(no changes listed)</li>';
    const head = summary ? `<p class="modal-summary">${escapeHtml(summary)}</p>` : '';
    els.modalBody.innerHTML = `${head}<ul class="change-diff">${lines}</ul>`;
  } else {
    const argText =
      args && Object.keys(args).length ? JSON.stringify(args, null, 2) : '(no arguments)';
    els.modalBody.innerHTML = `Run <code>${escapeHtml(name)}</code> against the live game?<pre>${escapeHtml(argText)}</pre>`;
  }
  els.modalDestructive.hidden = !destructive;
  els.modalDestructiveCheck.checked = false;
  els.modalConfirm.textContent = destructive ? 'Run destructive action' : 'Confirm';
  els.modalConfirm.disabled = !!destructive;
  els.modalBackdrop.hidden = false;
  return new Promise(resolve => {
    confirmResolver = resolve;
  });
}
function closeModal(result) {
  els.modalBackdrop.hidden = true;
  const r = confirmResolver;
  confirmResolver = null;
  if (r) r(result);
}

// --- Drawer ---
function updateGate() {
  if (els.gmGate) els.gmGate.hidden = !!settings.gmActionsEnabled;
}
function openDrawer() {
  els.drawerBackdrop.hidden = false;
  els.drawer.hidden = false;
  usage.trackView('dash.tools.view');
  updateGate();
  if (!toolsLoaded) void loadTools();
}
function closeDrawer() {
  usage.endView('dash.tools.view');
  els.drawer.hidden = true;
  els.drawerBackdrop.hidden = true;
}
function showBrowser() {
  els.toolDetail.hidden = true;
  els.toolBrowser.hidden = false;
}

// --- Tool catalog + list ---
async function loadTools(force) {
  try {
    const res = await fetch('/api/tools' + (force ? '?refresh=1' : ''), { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toolCatalog = Array.isArray(data.tools) ? data.tools : [];
    toolsLoaded = true;
    renderToolList(els.toolSearch.value);
  } catch (err) {
    els.toolList.innerHTML = `<p class="empty">Couldn't load tools: ${escapeHtml(String(err.message || err))}</p>`;
  }
}
function renderToolList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const matched = toolCatalog.filter(
    t => !q || t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
  );
  if (matched.length === 0) {
    els.toolList.innerHTML = `<p class="empty">No tools match that search.</p>`;
    return;
  }
  const groups = new Map();
  for (const t of matched) {
    const cat = categoryOf(t.name);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(t);
  }
  let html = '';
  for (const [cat, tools] of groups) {
    html += `<div class="tool-cat">${escapeHtml(cat)}</div>`;
    for (const t of tools) {
      html += `
        <button type="button" class="tool-item" data-track="dash.tools.open-tool" data-tool="${escapeHtml(t.name)}">
          <span class="tool-item-main">
            <span class="tool-item-name">${escapeHtml(t.name)}</span>
            <span class="tool-item-desc">${escapeHtml(t.description || '')}</span>
          </span>
          <span class="tool-kind ${escapeHtml(t.mutates)}">${escapeHtml(t.mutates)}</span>
        </button>`;
    }
  }
  els.toolList.innerHTML = html;
}

// --- Tool detail / form ---
async function openTool(name, prefill) {
  openDrawer();
  if (!toolsLoaded) await loadTools();
  const tool = findTool(name);
  if (!tool) {
    toast(`Tool "${name}" isn't in the catalog.`, 'warn');
    return;
  }
  els.toolBrowser.hidden = true;
  els.toolDetail.hidden = false;
  els.toolResult.hidden = true;
  els.toolResult.innerHTML = '';
  els.toolDetailName.textContent = tool.name;
  els.toolDetailKind.textContent = tool.mutates;
  els.toolDetailKind.className = `tool-kind ${tool.mutates}`;
  els.toolDetailDesc.textContent = tool.description || '';
  buildForm(tool, prefill || {});
}
function buildControl(def, prefillVal) {
  if (Array.isArray(def.enum)) {
    const sel = document.createElement('select');
    sel.className = 'field-control';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— choose —';
    sel.appendChild(blank);
    for (const v of def.enum) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      sel.appendChild(opt);
    }
    if (prefillVal !== undefined) sel.value = String(prefillVal);
    else if (def.default !== undefined) sel.value = String(def.default);
    return sel;
  }
  if (def.type === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    if (prefillVal === true || (prefillVal === undefined && def.default === true))
      cb.checked = true;
    return cb;
  }
  if (def.type === 'array') {
    const ta = document.createElement('textarea');
    ta.className = 'field-control';
    ta.placeholder = 'One value per line';
    if (Array.isArray(prefillVal)) ta.value = prefillVal.join('\n');
    return ta;
  }
  if (def.type === 'object') {
    const ta = document.createElement('textarea');
    ta.className = 'field-control';
    ta.placeholder = '{ } JSON';
    if (prefillVal && typeof prefillVal === 'object')
      ta.value = JSON.stringify(prefillVal, null, 2);
    return ta;
  }
  const input = document.createElement('input');
  input.className = 'field-control';
  input.type = def.type === 'number' || def.type === 'integer' ? 'number' : 'text';
  if (def.type === 'integer') input.step = '1';
  if (prefillVal !== undefined) input.value = String(prefillVal);
  else if (def.default !== undefined) input.value = String(def.default);
  return input;
}
function buildForm(tool, prefill) {
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const form = els.toolForm;
  form.innerHTML = '';
  const keys = Object.keys(props);
  for (const key of keys) {
    const def = props[key] || {};
    const field = document.createElement('div');
    field.className = 'field';
    field.dataset.key = key;
    field.dataset.type = def.type || 'string';
    const control = buildControl(def, prefill[key]);
    const label = document.createElement('label');
    label.innerHTML = `${escapeHtml(key)}${required.includes(key) ? '<span class="field-req">*</span>' : ''}`;
    const ref = pickerRef(def);
    if (def.type === 'boolean') {
      field.classList.add('field-check');
      field.appendChild(control);
      field.appendChild(label);
    } else if (ref) {
      field.appendChild(label);
      field.appendChild(buildRefPicker(def, ref, control, form));
    } else {
      field.appendChild(label);
      field.appendChild(control);
    }
    if (def.description) {
      const hint = document.createElement('div');
      hint.className = 'field-hint';
      hint.textContent = def.description;
      field.appendChild(hint);
    }
    form.appendChild(field);
  }
  if (keys.length === 0) {
    const p = document.createElement('p');
    p.className = 'field-hint';
    p.textContent = 'This tool takes no parameters.';
    form.appendChild(p);
  }
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const run = document.createElement('button');
  run.type = 'submit';
  run.className = 'btn btn-primary';
  run.textContent = tool.mutates === 'read' ? 'Run' : 'Run…';
  const err = document.createElement('span');
  err.className = 'form-error';
  actions.appendChild(run);
  actions.appendChild(err);
  form.appendChild(actions);
  form.onsubmit = e => {
    e.preventDefault();
    void submitToolForm(tool);
  };
}
// --- Pickers for parameters that name something ----------------------------
// A parameter annotated with `x-foundry-ref` (see shared/src/tool-refs.ts) gets
// a "Pick…" list of the current candidates from list-ref-choices. Typing by
// hand still works; picking only fills the field.
const REF_KEY = 'x-foundry-ref';
/** Kinds that list nothing until the GM types a search (large sets). */
const SEARCH_KINDS = new Set(['compendium-entry', 'document']);

function pickerRef(def) {
  const ref = def && def[REF_KEY];
  return ref && typeof ref === 'object' && ref.kind !== 'free' ? ref : null;
}
function refValue(ref, choice) {
  if (ref.value === 'uuid') return choice.uuid || choice.id;
  if (ref.value === 'name') return choice.name;
  return choice.id;
}
function fieldValues(control, multiple) {
  const raw = String(control.value || '');
  if (multiple) {
    return raw
      .split('\n')
      .map(v => v.trim())
      .filter(Boolean);
  }
  return raw.trim() ? [raw.trim()] : [];
}
/** The current value of a sibling parameter (the picker's parent), or ''. */
function siblingValue(form, key) {
  if (!key) return '';
  const field = [...form.querySelectorAll('.field')].find(f => f.dataset.key === key);
  const control = field && field.querySelector('.field-control');
  return control
    ? String(control.value || '')
        .split('\n')[0]
        .trim()
    : '';
}
function buildRefPicker(def, ref, control, form) {
  const multiple = def.type === 'array';
  const kinds = Array.isArray(ref.kind) ? ref.kind : [ref.kind];
  const needsSearch = kinds.every(k => SEARCH_KINDS.has(k));
  const wrap = document.createElement('div');
  wrap.className = 'ref-picker';
  wrap.innerHTML = `
    <div class="ref-row"></div>
    <div class="ref-hint" aria-live="polite"></div>
    <div class="ref-menu" hidden>
      <input type="search" class="ref-search" autocomplete="off" aria-label="Filter choices"
        placeholder="${needsSearch ? 'Type to search…' : 'Filter…'}" />
      <div class="ref-note"></div>
      <div class="ref-list" role="listbox"${multiple ? ' aria-multiselectable="true"' : ''}></div>
    </div>`;
  const row = wrap.querySelector('.ref-row');
  const hint = wrap.querySelector('.ref-hint');
  const menu = wrap.querySelector('.ref-menu');
  const search = wrap.querySelector('.ref-search');
  const note = wrap.querySelector('.ref-note');
  const list = wrap.querySelector('.ref-list');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn btn-small ref-open';
  open.textContent = 'Pick…';
  open.title = 'Choose from what exists now (you can still type)';
  open.setAttribute('aria-expanded', 'false');
  row.appendChild(control);
  row.appendChild(open);

  let rows = []; // [{ choice, group }]
  let loadSeq = 0;
  let searchTimer = null;
  const extras = (ref.extra || []).map(e => ({
    choice: { id: e.value, name: e.label, literal: e.value },
    group: 'Special',
  }));
  const valueOf = choice => (choice.literal !== undefined ? choice.literal : refValue(ref, choice));

  async function load(query) {
    const seq = ++loadSeq;
    note.textContent = 'Loading…';
    const parent = siblingValue(form, ref.parent);
    const results = await Promise.all(
      kinds.map(kind =>
        callReadTool('list-ref-choices', {
          kind,
          ...(ref.filter ? { filter: ref.filter } : {}),
          ...(parent ? { parent } : {}),
          ...(query ? { query } : {}),
          limit: 200,
        }).catch(err => ({ kind, choices: [], truncated: false, note: `✗ ${err.message || err}` }))
      )
    );
    if (seq !== loadSeq) return; // a newer search replaced this one
    const notes = results.map(r => r.note).filter(Boolean);
    if (results.some(r => r.truncated)) notes.push('More exist: type to narrow the list.');
    rows = [
      ...extras,
      ...results.flatMap(r =>
        (r.choices || []).map(c => ({
          choice: c,
          group: c.group || (kinds.length > 1 ? r.kind : ''),
        }))
      ),
    ];
    note.textContent = notes.join(' · ');
    render();
  }

  function render() {
    const q = needsSearch ? '' : search.value.trim().toLowerCase();
    const selected = new Set(fieldValues(control, multiple));
    const counts = new Map();
    for (const { choice } of rows) counts.set(choice.name, (counts.get(choice.name) || 0) + 1);
    const shown = rows.filter(
      ({ choice, group }) =>
        !q ||
        `${choice.name} ${choice.detail || ''} ${group} ${choice.id}`.toLowerCase().includes(q)
    );
    list.innerHTML = '';
    if (shown.length === 0) {
      const empty = rows.length
        ? 'Nothing matches.'
        : needsSearch
          ? 'Type at least 2 letters.'
          : 'Nothing to pick.';
      list.innerHTML = `<p class="ref-empty">${empty}</p>`;
      return;
    }
    let lastGroup = null;
    for (const { choice, group } of shown) {
      if (group !== lastGroup) {
        lastGroup = group;
        if (group) {
          const heading = document.createElement('div');
          heading.className = 'ref-group';
          heading.textContent = group;
          list.appendChild(heading);
        }
      }
      const value = valueOf(choice);
      const isSelected = selected.has(value);
      const sameName =
        ref.value === 'name' && choice.literal === undefined && counts.get(choice.name) > 1;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ref-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      item.title = ref.value === 'name' ? choice.name : `${choice.name} → ${value}`;
      item.innerHTML = `
        <span class="ref-check">${isSelected ? '✓' : ''}</span>
        <span class="ref-name">${escapeHtml(choice.name)}${
          choice.hidden ? ' <span class="ref-flag" title="Hidden from players">hidden</span>' : ''
        }</span>
        <span class="ref-detail">${escapeHtml(choice.detail || '')}${
          sameName
            ? ` <span class="ref-warn" title="The tool matches by name; several share it">same name ×${counts.get(choice.name)}</span>`
            : ''
        }</span>`;
      item.addEventListener('click', () => {
        usage.track('action', 'dash.tools.pick-choice');
        pick(choice);
      });
      list.appendChild(item);
    }
  }

  function describe(values) {
    if (values.length === 0) return '';
    if (ref.value === 'name') return values.length > 1 ? `${values.length} selected` : '';
    return values
      .map(v => {
        const found = rows.find(({ choice }) => valueOf(choice) === v);
        return found ? found.choice.name : v;
      })
      .join(', ');
  }

  function pick(choice) {
    const value = valueOf(choice);
    if (multiple) {
      const values = fieldValues(control, true);
      const at = values.indexOf(value);
      if (at >= 0) values.splice(at, 1);
      else values.push(value);
      control.value = values.join('\n');
      render();
    } else {
      control.value = value;
      close();
    }
    hint.textContent = describe(fieldValues(control, multiple));
  }

  function onOutside(e) {
    if (!wrap.contains(e.target)) close();
  }
  function close() {
    menu.hidden = true;
    open.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside);
  }
  function show() {
    menu.hidden = false;
    open.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside);
    search.value = '';
    search.focus();
    rows = extras.slice();
    if (needsSearch) {
      note.textContent = 'Type at least 2 letters to search.';
      render();
    } else {
      void load('');
    }
  }

  open.addEventListener('click', () => {
    if (menu.hidden) {
      usage.track('action', 'dash.tools.pick-open');
      show();
    } else {
      close();
    }
  });
  search.addEventListener('input', () => {
    if (!needsSearch) {
      render();
      return;
    }
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < 2) {
      rows = extras.slice();
      note.textContent = 'Type at least 2 letters to search.';
      render();
      return;
    }
    searchTimer = setTimeout(() => void load(q), 250);
  });
  wrap.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) {
      usage.trackShortcut('dash.shortcut.escape-picker');
      e.preventDefault();
      e.stopPropagation();
      close();
      open.focus();
    }
  });
  control.addEventListener('input', () => {
    hint.textContent = describe(fieldValues(control, multiple));
  });
  return wrap;
}

function coerceScalar(raw, def) {
  if (def.type === 'number') return Number(raw);
  if (def.type === 'integer') return parseInt(raw, 10);
  return raw;
}
function collectArgs(tool, form) {
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const args = {};
  const missing = [];
  for (const field of form.querySelectorAll('.field')) {
    const key = field.dataset.key;
    if (!key) continue;
    const def = props[key] || {};
    const control = field.querySelector('.field-control, input[type=checkbox]');
    if (!control) continue;
    if (def.type === 'boolean') {
      if (!control.checked && !required.includes(key)) continue;
      args[key] = control.checked;
      continue;
    }
    if (def.type === 'array') {
      const items = control.value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      if (items.length === 0) {
        if (required.includes(key)) missing.push(key);
        continue;
      }
      const it = def.items && def.items.type;
      args[key] = items.map(s => (it === 'number' || it === 'integer' ? Number(s) : s));
      continue;
    }
    const raw = (control.value || '').trim();
    if (!raw) {
      if (required.includes(key)) missing.push(key);
      continue;
    }
    if (def.type === 'object') {
      try {
        args[key] = JSON.parse(raw);
      } catch {
        throw new Error(`"${key}" must be valid JSON.`);
      }
    } else {
      args[key] = coerceScalar(raw, def);
    }
  }
  if (missing.length) throw new Error(`Required: ${missing.join(', ')}`);
  return args;
}
async function submitToolForm(tool) {
  const errEl = els.toolForm.querySelector('.form-error');
  if (errEl) errEl.textContent = '';
  let args;
  try {
    args = collectArgs(tool, els.toolForm);
  } catch (e) {
    if (errEl) errEl.textContent = String(e.message || e);
    return;
  }
  await runTool(tool.name, args, tool.mutates, { showResultInDrawer: true });
}
function showToolResult(ok, payload) {
  els.toolResult.hidden = false;
  els.toolResult.className = `tool-result ${ok ? 'ok' : 'err'}`;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  els.toolResult.innerHTML = `<strong>${ok ? 'Result' : 'Error'}</strong><pre>${escapeHtml(text)}</pre>`;
}

// A guarded change names itself by its summary, e.g. 'Applied: Reveal page "A Letter" to
// players (copied into Handouts)'; other tools by their name.
function doneText(name, result) {
  const summary = result && typeof result.summary === 'string' ? result.summary : '';
  if (name === 'apply-planned-change' && summary) return `✓ Applied: ${summary}`;
  if (name === 'undo-change' && summary) return `✓ ${summary}`;
  return `✓ ${name}`;
}

// The code for a failed read call: the HTTP status in its message, else a generic one.
function toolErrorCode(err) {
  const m = /-> (\d{3})\b|HTTP (\d{3})\b/.exec(String((err && err.message) || err));
  return m ? m[1] || m[2] : 'error';
}

// --- Run a tool (confirm-gated for writes) ---
async function runTool(name, args, mutates, opts = {}) {
  const found = findTool(name);
  let kind = mutates || (found && found.mutates) || 'write';
  let confirmFlags = {};
  let diff = opts.diff;
  let summary = opts.summary;
  if (kind !== 'read') {
    if (!settings.gmActionsEnabled) {
      usage.trackTool(name, 'error', 'gm-actions-off');
      toast('GM Actions are off — enable them to run this.', 'warn');
      openDrawer();
      return;
    }
    if (name === 'apply-planned-change') {
      // Show the plan's diff, and ask for the destructive confirm when it deletes.
      let plan;
      try {
        plan = await callReadTool('get-planned-change', { planId: args && args.planId });
      } catch (err) {
        usage.trackTool(name, 'error', toolErrorCode(err));
        toast(`✗ Can't load the plan: ${String(err.message || err)}`, 'err');
        return;
      }
      diff = (plan.diff || []).map(d => d.text);
      summary = plan.summary;
      kind = plan.risk === 'destructive' ? 'destructive' : 'write';
    }
    const ok = await confirmAction({
      title: kind === 'destructive' ? 'Destructive action' : 'Confirm action',
      name,
      args,
      destructive: kind === 'destructive',
      diff,
      summary,
    });
    if (!ok) {
      usage.trackTool(name, 'cancelled');
      return;
    }
    confirmFlags =
      kind === 'destructive' ? { confirm: true, confirmDestructive: true } : { confirm: true };
  }
  try {
    const res = await fetch('/api/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, args: args || {}, ...confirmFlags }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      usage.trackTool(name, 'ok');
      toast(doneText(name, data.result), 'ok');
      // A handout reveal that copies the page says where the copy goes ("Copied into Handouts").
      if (data.result && data.result.copy && typeof data.result.note === 'string') {
        toast(data.result.note, 'ok');
      }
      if (opts.showResultInDrawer) showToolResult(true, data.result);
      if (name === 'apply-planned-change' || name === 'undo-change') {
        scheduleChangesReload();
        if (!els.tarokkaDrawer.hidden) void loadTarokka();
        if (!els.partyDrawer.hidden) void loadParty();
      }
      return data;
    }
    const msg = data.error || `HTTP ${res.status}`;
    // The code is what failed: the server's kind (tool, timeout, channel) or the HTTP status.
    usage.trackTool(name, 'error', data.kind || String(res.status));
    if (res.status === 403) {
      toast('GM Actions are off — enable them first.', 'warn');
      openDrawer();
    } else {
      toast(`✗ ${name}: ${msg}`, 'err', data.kind || String(res.status));
    }
    if (opts.showResultInDrawer) showToolResult(false, msg);
  } catch (err) {
    const msg = String(err.message || err);
    usage.trackTool(name, 'error', 'network');
    toast(`✗ ${name}: ${msg}`, 'err', 'network');
    if (opts.showResultInDrawer) showToolResult(false, msg);
  }
}

// --- Read-only tool call (no confirmation needed) ---
async function callReadTool(name, args) {
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, args: args || {} }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.result;
}

// --- Recent guarded changes (with undo) ---
function scheduleChangesReload() {
  if (changesReloadTimer) clearTimeout(changesReloadTimer);
  changesReloadTimer = setTimeout(() => {
    changesReloadTimer = null;
    void loadRecentChanges();
  }, 400);
}
async function loadRecentChanges() {
  try {
    const result = await callReadTool('list-recent-changes', { limit: 20 });
    recentChanges = Array.isArray(result && result.changes) ? result.changes : [];
    renderRecentChanges();
  } catch (err) {
    els.changesMeta.textContent = '—';
    els.changesBody.innerHTML = `<p class="empty">Couldn't load changes: ${escapeHtml(String(err.message || err))}</p>`;
  }
}
function changeState(c) {
  if (c.mode === 'undo') return 'undo';
  if (c.undoneBy) return 'undone';
  return c.risk === 'destructive' ? 'destructive' : 'applied';
}
// The renderer files changes by UTC month of `appliedAt` (see obsidian/export.ts: `appliedAt.slice(0, 7)`).
function obsidianChangeUrl(c) {
  const month = typeof c.appliedAt === 'string' ? c.appliedAt.slice(0, 7) : '';
  return month ? obsidianFileUrl(`AI Tool/Changes/${month}`) : null;
}
function renderRecentChanges() {
  els.changesMeta.textContent = `${recentChanges.length} shown`;
  if (recentChanges.length === 0) {
    els.changesBody.innerHTML = '<p class="empty">No guarded changes yet.</p>';
    return;
  }
  els.changesBody.innerHTML = recentChanges
    .map(c => {
      const state = changeState(c);
      const time = new Date(c.appliedAt).toLocaleString();
      const lines = c.diff || [];
      const diff = lines.map(line => `<li>${escapeHtml(line)}</li>`).join('');
      const undo = c.canUndo
        ? `<button type="button" class="btn btn-small" data-track="dash.changes.undo" data-undo="${escapeHtml(c.changeId)}">Undo</button>`
        : '';
      const details = diff
        ? `<details><summary data-track="dash.changes.show-diff">${lines.length} line(s)</summary><ul class="change-diff">${diff}</ul></details>`
        : '';
      const obsidianUrl = obsidianChangeUrl(c);
      const obsidianLink = obsidianUrl
        ? `<a class="link-btn" data-track="dash.changes.open-obsidian" href="${escapeHtml(obsidianUrl)}" target="_blank" rel="noopener" title="Open this month's change log in Obsidian">📓</a>`
        : '';
      return `
        <div class="change-entry state-${state}">
          <div class="change-head">
            <span class="change-summary">${escapeHtml(c.summary)}</span>
            ${undo}
          </div>
          <div class="change-meta">
            <span class="change-state">${escapeHtml(state)}</span>
            <span>${escapeHtml(c.feature)}</span>
            <span>${escapeHtml(c.target)}</span>
            <span>${escapeHtml(time)}</span>
            ${obsidianLink}
          </div>
          ${details}
        </div>`;
    })
    .join('');
}

// --- Handouts drawer (GM only; I-039) ---
// The queue and the seen log come from list-revealed-pages; queueing and
// unqueueing are plain calls (GM prep, nothing in Foundry changes); "Reveal
// next" is a guarded reveal for the active scene, applied after the confirm.
let handoutsView = { pages: [], queue: [] };
let handoutScenes = new Map();
let activeSceneId = null;
let handoutPlayers = [];

function openHandouts() {
  usage.trackView('dash.handouts.view');
  els.drawerBackdrop.hidden = false;
  els.handoutsDrawer.hidden = false;
  void loadHandouts();
}
function closeHandouts() {
  usage.endView('dash.handouts.view');
  els.handoutsDrawer.hidden = true;
  if (
    els.drawer.hidden &&
    els.tarokkaDrawer.hidden &&
    els.preflightDrawer.hidden &&
    els.prepDrawer.hidden &&
    els.partyDrawer.hidden
  ) {
    els.drawerBackdrop.hidden = true;
  }
}
async function loadHandouts() {
  try {
    const [view, scenes, names] = await Promise.all([
      callReadTool('list-revealed-pages', {}),
      callReadTool('list-scenes', {}).catch(() => []),
      fetch('/api/player/names', { headers: authHeaders() })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []),
    ]);
    handoutsView = {
      pages: Array.isArray(view && view.pages) ? view.pages : [],
      queue: Array.isArray(view && view.queue) ? view.queue : [],
    };
    const list = Array.isArray(scenes)
      ? scenes
      : Array.isArray(scenes && scenes.scenes)
        ? scenes.scenes
        : [];
    handoutScenes = new Map(list.map(s => [s.id, s.name]));
    const active = list.find(s => s.active);
    activeSceneId = active ? active.id : null;
    handoutPlayers = Array.isArray(names) ? names : [];
    renderHandoutsDrawer();
  } catch (err) {
    els.handoutsQueue.innerHTML = `<li class="empty">Couldn't load the handouts: ${escapeHtml(String(err.message || err))}</li>`;
  }
}
function playerNameOf(userId) {
  const p = handoutPlayers.find(n => n.userId === userId);
  return p ? p.name : userId;
}
function audienceText(players) {
  return Array.isArray(players) && players.length > 0
    ? `for ${players.map(playerNameOf).join(', ')}`
    : 'for every player';
}
/** The queue entry "Reveal next" takes: the oldest for the active scene or any scene. */
function nextQueued() {
  return (
    handoutsView.queue.find(
      q => q.sceneId === null || activeSceneId === null || q.sceneId === activeSceneId
    ) || null
  );
}
function renderHandoutsDrawer() {
  const { queue, pages } = handoutsView;
  const next = nextQueued();
  els.handoutsNext.disabled = !next;
  els.handoutsNext.textContent = next ? `Reveal next: ${next.title || 'Untitled'}` : 'Reveal next';
  els.handoutsQueue.innerHTML =
    queue.length === 0
      ? '<li class="empty">Nothing queued. Queue pages during prep, then reveal each in one click.</li>'
      : queue
          .map(q => {
            const scene = q.sceneId ? handoutScenes.get(q.sceneId) || 'another scene' : 'any scene';
            const missing = q.exists ? '' : ' <span class="pf-detail">(page deleted)</span>';
            return `<li class="preflight-item${next && next.entryId === q.entryId ? ' pf-info' : ''}">
              <span class="pf-text"><span class="pf-label">${escapeHtml(q.title || 'Untitled')}${missing}</span>
              <span class="pf-detail">${escapeHtml(scene)} · ${escapeHtml(audienceText(q.players))}</span></span>
              <button type="button" class="btn btn-small" data-track="dash.handouts.unqueue" data-unqueue="${escapeHtml(q.uuid)}">Remove</button>
            </li>`;
          })
          .join('');
  const shown = pages.filter(p => p.feature === 'handouts' || p.copiedFrom);
  els.handoutsRevealed.innerHTML =
    shown.length === 0
      ? '<li class="empty">No handout revealed yet.</li>'
      : shown
          .map(p => {
            const audience =
              Array.isArray(p.players) && p.players.length > 0
                ? p.players
                : handoutPlayers.map(n => n.userId);
            const seen = new Map((p.seenBy || []).map(s => [s.userId, s]));
            const ticks = audience
              .map(id => {
                const s = seen.get(id);
                const when = s
                  ? new Date(s.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '';
                return `<span class="seen-tick${s ? ' seen' : ''}" title="${s ? `Opened ${escapeHtml(when)}` : 'Not opened yet'}">${s ? '✓' : '·'} ${escapeHtml(playerNameOf(id))}</span>`;
              })
              .join(' ');
            return `<li class="preflight-item">
              <span class="pf-text"><span class="pf-label">${p.exists ? escapeHtml(p.title || 'Untitled') : '(page deleted)'}</span>
              <span class="pf-detail">${escapeHtml(audienceText(p.players))}${p.observable ? '' : ' · not visible in Foundry'}</span>
              <span class="seen-row">${ticks || '<span class="pf-detail">No players known yet.</span>'}</span></span>
            </li>`;
          })
          .join('');
}
async function revealNextHandout() {
  await planThenApply('plan-page-reveal', {
    action: 'reveal-next',
    ...(activeSceneId ? { sceneId: activeSceneId } : {}),
  });
  void loadHandouts();
}
async function unqueueHandout(uuid) {
  try {
    await callReadTool('plan-page-reveal', { action: 'unqueue', pageUuid: uuid });
    usage.trackTool('plan-page-reveal', 'ok');
  } catch (err) {
    usage.trackTool('plan-page-reveal', 'error', toolErrorCode(err));
    toast(`✗ plan-page-reveal: ${String(err.message || err)}`, 'err');
  }
  void loadHandouts();
}

// --- Prep drawer (GM only; I-045) ---
// Facts from the read tool get-prep-digest (the generic, GM-only /api/tool proxy carries it).
// "Refresh" reloads the current view; "All beats" loads the last-session action. No AI.
let prepDigest = null;
let prepAction = 'summary';
let prepLoading = false;

function openPrep() {
  usage.trackView('dash.prep.view');
  els.drawerBackdrop.hidden = false;
  els.prepDrawer.hidden = false;
  void loadPrep();
}
function closePrep() {
  usage.endView('dash.prep.view');
  els.prepDrawer.hidden = true;
  if (
    els.drawer.hidden &&
    els.tarokkaDrawer.hidden &&
    els.preflightDrawer.hidden &&
    els.handoutsDrawer.hidden &&
    els.partyDrawer.hidden
  ) {
    els.drawerBackdrop.hidden = true;
  }
}
function clearPrepSections() {
  for (const el of [
    els.prepWarnings,
    els.prepThreads,
    els.prepNotes,
    els.prepReady,
    els.prepChanges,
    els.prepTarokka,
  ]) {
    el.innerHTML = '';
  }
}
async function loadPrep(action = prepAction) {
  if (prepLoading) return;
  prepLoading = true;
  els.prepRefresh.disabled = true;
  els.prepSub.textContent = 'Loading…';
  try {
    const digest = await callReadTool('get-prep-digest', { action });
    if (!digest || typeof digest !== 'object') throw new Error('The bridge sent no digest.');
    prepDigest = digest;
    prepAction = action;
    renderPrep();
  } catch (err) {
    els.prepSub.textContent = 'GM only. The digest did not load.';
    clearPrepSections();
    els.prepLast.innerHTML = `<p class="empty">Couldn't load the prep digest: ${escapeHtml(String(err.message || err))}</p>`;
  } finally {
    prepLoading = false;
    els.prepRefresh.disabled = false;
  }
}
function prepClock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function prepMinutes(min) {
  const n = Math.max(0, Math.round(Number(min) || 0));
  return n >= 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`;
}
function prepCount(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
function prepRow(label, detail, extra = '') {
  return `<li class="preflight-item">
      <span class="pf-text"><span class="pf-label">${escapeHtml(label)}</span>${
        detail ? `<span class="pf-detail">${escapeHtml(detail)}</span>` : ''
      }</span>${extra}
    </li>`;
}
function prepOpenButton(journalId) {
  if (!journalId) return '';
  return `<button type="button" class="btn btn-small" data-track="dash.prep.open-journal" data-prep-open="JournalEntry.${escapeHtml(journalId)}">Open</button>`;
}
function prepLastSession(last) {
  if (!last) return '<p class="empty">No play session recorded yet.</p>';
  const deaths = Array.isArray(last.deaths) ? last.deaths : [];
  const handouts = Array.isArray(last.handoutsRevealed) ? last.handoutsRevealed : [];
  const scenes = Array.isArray(last.scenes) ? last.scenes : [];
  const beats = Array.isArray(last.beats) ? last.beats : [];
  const rows = [
    prepRow(
      last.label || `Session ${last.number}`,
      `${last.date || ''} · ${prepMinutes(last.durationMin)}`
    ),
    prepRow('Scenes', scenes.length > 0 ? scenes.join(', then ') : 'None'),
    prepRow(
      'Fights',
      `${prepCount(last.combats || 0, 'fight', 'fights')}, ${prepCount(last.combatRounds || 0, 'round', 'rounds')}`
    ),
    prepRow(
      'Downs',
      prepCount(last.pcDowns || 0, 'player character down', 'player character downs')
    ),
    prepRow('Deaths', deaths.length > 0 ? deaths.join(', ') : 'None'),
  ];
  const handoutRows =
    handouts.length === 0
      ? '<p class="pf-detail">No handouts revealed.</p>'
      : `<ul class="preflight-list">${handouts
          .map(h => {
            const seen = Array.isArray(h.seenBy) ? h.seenBy : [];
            return prepRow(
              h.title || 'Untitled',
              seen.length > 0 ? `Seen by ${seen.join(', ')}` : 'Not opened by anyone yet'
            );
          })
          .join('')}</ul>`;
  const beatRows = beats
    .map(
      b =>
        `<li><span class="prep-beat-time">${escapeHtml(prepClock(b.at))}</span> ${escapeHtml(String(b.kind || '').replace(/-/g, ' '))}: ${escapeHtml(b.text || '')}</li>`
    )
    .join('');
  const moreBeats =
    prepAction === 'summary' && last.beatsTruncated
      ? '<button type="button" class="btn btn-small" data-track="dash.prep.all-beats" data-prep-beats>All beats</button>'
      : '';
  const beatsNote = last.beatsTruncated
    ? `<p class="pf-detail">${prepAction === 'summary' ? 'Only the latest beats are shown.' : 'Only the latest 200 beats are shown.'}</p>`
    : '';
  const beatsBlock =
    beats.length === 0
      ? '<p class="pf-detail">No beats recorded.</p>'
      : `<details class="prep-beats"><summary data-track="dash.prep.show-beats">Beats (${beats.length})</summary><ul>${beatRows}</ul>${beatsNote}</details>`;
  return `<ul class="preflight-list">${rows.join('')}</ul>
    <h4 class="prep-sub-h">Handouts revealed</h4>${handoutRows}
    ${beatsBlock}${moreBeats}`;
}
function prepThreads(d) {
  const quests = d.openQuests;
  const campaigns = d.openCampaignParts;
  const questHtml =
    quests === null || quests === undefined
      ? '<p class="empty">Needs Foundry: quests are not loaded.</p>'
      : quests.length === 0
        ? '<p class="empty">No open quests.</p>'
        : `<ul class="preflight-list">${quests
            .map(q => prepRow(q.name, q.status || 'Open', prepOpenButton(q.journalId)))
            .join('')}</ul>`;
  const campaignHtml =
    campaigns === null || campaigns === undefined
      ? '<p class="empty">Needs Foundry: campaign parts are not loaded.</p>'
      : campaigns.length === 0
        ? '<p class="empty">No open campaign parts.</p>'
        : campaigns
            .map(
              c =>
                `<h4 class="prep-sub-h">${escapeHtml(c.name)} ${prepOpenButton(c.journalId)}</h4><ul class="preflight-list">${(
                  c.parts || []
                )
                  .map(p => prepRow(p.title, String(p.status || '').replace(/_/g, ' ')))
                  .join('')}</ul>`
            )
            .join('');
  return `<h4 class="prep-sub-h">Quests</h4>${questHtml}<h4 class="prep-sub-h">Campaign parts</h4>${campaignHtml}`;
}
function prepNotes(next) {
  if (next === undefined) return '';
  if (next === null) {
    return `<p class="empty">Create a GM-only journal named 'Next session' in Foundry for your prep notes.</p>`;
  }
  const warn = next.playerVisible
    ? '<div class="preflight-summary pf-warn">Players can see this journal</div>'
    : '';
  const pages = Array.isArray(next.pages) ? next.pages : [];
  const body =
    pages.length === 0
      ? '<p class="empty">The journal has no pages yet.</p>'
      : pages
          .map(
            p => `<div class="prep-note">
              <div class="pf-label">${escapeHtml(p.name || 'Untitled')}</div>
              <div class="prep-note-text">${escapeHtml(p.text || '')}${p.truncated ? ' …' : ''}</div>
            </div>`
          )
          .join('');
  return `${warn}<p class="pf-detail">${escapeHtml(next.name || 'Next session')} ${prepOpenButton(next.journalId)}</p>${body}`;
}
function prepCounter(label, c) {
  return c ? `${label} ${c.remaining}/${c.max}` : '';
}
function prepReady(d) {
  const queue = Array.isArray(d.handoutQueue) ? d.handoutQueue : [];
  const groups = new Map();
  for (const q of queue) {
    const key = q.sceneName || 'Any scene';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  const queueHtml =
    queue.length === 0
      ? '<p class="empty">No handouts queued.</p>'
      : [...groups]
          .map(
            ([scene, items]) =>
              `<h4 class="prep-sub-h">${escapeHtml(scene)}</h4><ul class="preflight-list">${items
                .map(q =>
                  prepRow(
                    q.title || 'Untitled',
                    Array.isArray(q.players) && q.players.length > 0
                      ? `For ${prepCount(q.players.length, 'player', 'players')}`
                      : ''
                  )
                )
                .join('')}</ul>`
          )
          .join('');
  const bosses = d.bosses;
  const bossHtml =
    bosses === null || bosses === undefined
      ? '<p class="empty">Needs Foundry: bosses are not loaded.</p>'
      : bosses.length === 0
        ? '<p class="empty">No boss creatures on scenes.</p>'
        : `<ul class="preflight-list">${bosses
            .map(b => {
              const bits = [
                b.sceneName,
                prepCounter('Legendary', b.legendary),
                prepCounter('Resistances', b.resistances),
                b.lair ? (b.lair.inside ? 'Lair: inside' : 'Lair') : '',
              ].filter(Boolean);
              return prepRow(`${b.tokenName}${b.hidden ? ' (hidden)' : ''}`, bits.join(' · '));
            })
            .join('')}</ul>`;
  const pf = d.preflight;
  let pfHtml;
  if (!pf) {
    pfHtml = '<p class="empty">The pre-flight check could not run.</p>';
  } else {
    const items = Array.isArray(pf.items) ? pf.items : [];
    const list =
      items.length === 0
        ? ''
        : `<ul class="preflight-list">${items
            .map(i => {
              const sev = PREFLIGHT_ICONS[i.severity] ? i.severity : 'unknown';
              return `<li class="preflight-item pf-${sev}"><span class="pf-icon">${PREFLIGHT_ICONS[sev]}</span><span class="pf-text"><span class="pf-label">${escapeHtml(i.title)}</span></span></li>`;
            })
            .join('')}</ul>`;
    pfHtml = `<p class="pf-detail">${escapeHtml(`${pf.fail} to fix, ${pf.warn} to look at`)}</p>${list}
      <button type="button" class="btn btn-small" data-track="dash.prep.open-preflight" data-prep-preflight>Open Pre-flight</button>`;
  }
  return `<h4 class="prep-sub-h">Handout queue</h4>${queueHtml}
    <h4 class="prep-sub-h">Bosses</h4>${bossHtml}
    <h4 class="prep-sub-h">Pre-flight</h4>${pfHtml}`;
}
function prepChanges(rc) {
  const count = rc && Number.isFinite(rc.count) ? rc.count : 0;
  const latest = rc && Array.isArray(rc.latest) ? rc.latest : [];
  if (count === 0) return '<p class="empty">No changes made through the tool yet.</p>';
  return `<p class="pf-detail">${prepCount(count, 'change', 'changes')} made through the tool.</p>
    <ul class="preflight-list">${latest
      .map(c =>
        prepRow(c.title || 'Change', c.appliedAt ? new Date(c.appliedAt).toLocaleString() : '')
      )
      .join('')}</ul>`;
}
function renderPrep() {
  const d = prepDigest;
  if (!d) return;
  const loaded = prepClock(new Date(Number(d.computedAt) || Date.now()).toISOString());
  els.prepSub.textContent = `GM only. Loaded ${loaded || 'just now'}.`;
  const warnings = Array.isArray(d.warnings) ? d.warnings : [];
  els.prepWarnings.innerHTML = warnings
    .map(w => `<div class="preflight-summary pf-warn">${escapeHtml(w)}</div>`)
    .join('');
  els.prepLast.innerHTML = prepLastSession(d.lastSession);
  els.prepThreads.innerHTML = prepThreads(d);
  els.prepNotes.innerHTML = prepNotes(d.nextSession);
  els.prepReady.innerHTML = prepReady(d);
  els.prepChanges.innerHTML = prepChanges(d.recentChanges);
  els.prepTarokka.innerHTML =
    d.tarokka && d.tarokka.hasReading ? '<p class="pf-detail">A Tarokka reading exists.</p>' : '';
}
async function onPrepClick(e) {
  const open = e.target.closest('[data-prep-open]');
  if (open) {
    try {
      await callReadTool('open-in-foundry', { uuid: open.dataset.prepOpen });
      toast('Opened in Foundry', 'ok');
    } catch (err) {
      toast(`✗ open-in-foundry: ${String(err.message || err)}`, 'err');
    }
    return;
  }
  if (e.target.closest('[data-prep-beats]')) {
    void loadPrep('last-session');
    return;
  }
  if (e.target.closest('[data-prep-preflight]')) {
    closePrep();
    openPreflight();
  }
}

// --- Pre-flight drawer (GM only; I-068) ---
// Automatic checks come from GET /api/preflight (bridge + dashboard); the
// Tarokka "Show cards" box is checked here. Manual ticks stay in this browser.
const PREFLIGHT_MANUAL = [
  ['scene-nav', 'The starting scene has a Navigation Name if its real name is a spoiler.'],
  [
    'creature-names',
    'Creatures whose names the players know show them (Prototype Token, Identity, Display Name: Hovered by Anyone).',
  ],
  ['hidden-tokens', 'Tokens the players should not know about yet are hidden.'],
  [
    'player-tab',
    'Opened /player in a second tab: combat order, feed and handouts show no secrets.',
  ],
  ['handouts', 'Handout pages are set to None unless you revealed them.'],
  ['prep-prompt', 'Ran the prep-next-session prompt in Claude Desktop.'],
  ['last-note', "Read last session's note in Obsidian."],
  [
    'private-screen',
    'Claude Desktop, the dashboard and Obsidian are on the screen the players cannot see.',
  ],
];
const PREFLIGHT_TICKS_KEY = 'cogm_preflight_ticks';
const PREFLIGHT_ICONS = { ok: '✓', warn: '!', fail: '✗', info: 'i', unknown: '?' };
let preflightResult = null;
let preflightRunning = false;

function readPreflightTicks() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFLIGHT_TICKS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}
function writePreflightTicks(ticks) {
  try {
    localStorage.setItem(PREFLIGHT_TICKS_KEY, JSON.stringify(ticks));
  } catch {}
}
function openPreflight() {
  usage.trackView('dash.preflight.view');
  els.drawerBackdrop.hidden = false;
  els.preflightDrawer.hidden = false;
  renderPreflightManual();
  void runPreflight();
}
function closePreflight() {
  usage.endView('dash.preflight.view');
  els.preflightDrawer.hidden = true;
  if (
    els.drawer.hidden &&
    els.tarokkaDrawer.hidden &&
    els.handoutsDrawer.hidden &&
    els.prepDrawer.hidden &&
    els.partyDrawer.hidden
  ) {
    els.drawerBackdrop.hidden = true;
  }
}
/** The checks the browser itself can make. */
function localPreflightChecks() {
  const shown = els.tarokkaShow.checked;
  return [
    {
      id: 'tarokka-hidden',
      label: 'Tarokka cards hidden',
      status: shown ? 'warn' : 'ok',
      detail: shown
        ? 'Show cards is ticked in the Tarokka drawer. Untick it before players can see your screen.'
        : 'Show cards is not ticked.',
    },
  ];
}
async function runPreflight({ quiet = false } = {}) {
  if (preflightRunning) return;
  preflightRunning = true;
  if (!quiet) {
    els.preflightRun.disabled = true;
    els.preflightSub.textContent = 'Running checks…';
  }
  try {
    const res = await fetch('/api/preflight', { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    preflightResult = data;
    renderVersionBanner();
    renderPreflightButton();
    if (!els.preflightDrawer.hidden) renderPreflight();
  } catch (err) {
    if (!quiet) {
      els.preflightSub.textContent = 'GM only. The checks did not run.';
      els.preflightAuto.innerHTML = `<li class="empty">Couldn't run the checks: ${escapeHtml(String(err.message || err))}</li>`;
    }
  } finally {
    preflightRunning = false;
    els.preflightRun.disabled = false;
  }
}
function allPreflightChecks() {
  const checks =
    preflightResult && Array.isArray(preflightResult.checks) ? preflightResult.checks : [];
  return [...checks, ...localPreflightChecks()];
}
function renderPreflightButton() {
  if (!preflightResult) {
    els.btnPreflight.textContent = '✈ Pre-flight';
    return;
  }
  const fails = allPreflightChecks().filter(c => c.status === 'fail').length;
  els.btnPreflight.textContent =
    fails > 0 ? `✈ Pre-flight: ${fails} to fix` : '✈ Pre-flight: ready';
  els.btnPreflight.classList.toggle('preflight-bad', fails > 0);
}
// PB-10: a module and bridge pair with different versions gets a banner.
function renderVersionBanner() {
  const versions = allPreflightChecks().find(c => c.id === 'versions');
  if (!versions || versions.status !== 'fail') {
    els.versionBanner.hidden = true;
    return;
  }
  els.versionBanner.textContent = versions.detail;
  els.versionBanner.hidden = false;
}
function preflightItem(c) {
  const status = PREFLIGHT_ICONS[c.status] ? c.status : 'unknown';
  return `<li class="preflight-item pf-${status}">
      <span class="pf-icon" title="${escapeHtml(status)}">${PREFLIGHT_ICONS[status]}</span>
      <span class="pf-text"><span class="pf-label">${escapeHtml(c.label)}</span>
      <span class="pf-detail">${escapeHtml(c.detail)}</span></span>
    </li>`;
}
function preflightFindings(scan) {
  if (!scan) return '';
  const rows = [];
  for (const s of scan.settings || []) {
    rows.push(
      `<li><code>${escapeHtml(s.setting)}</code> ${escapeHtml(s.masked)}: ${escapeHtml(s.reason)}</li>`
    );
  }
  for (const n of scan.names || []) {
    rows.push(
      `<li>${escapeHtml(n.kind)} "${escapeHtml(n.name)}" names ${escapeHtml((n.terms || []).join(', '))}</li>`
    );
  }
  for (const m of scan.modules || []) {
    rows.push(`<li>${escapeHtml(m.title)}: ${escapeHtml(m.reason)}</li>`);
  }
  if (rows.length === 0) return '';
  return `<details class="preflight-findings"><summary data-track="dash.preflight.show-findings">${rows.length} finding(s)</summary><ul>${rows.join('')}</ul></details>`;
}
function renderPreflight() {
  const r = preflightResult;
  if (!r) return;
  const checks = allPreflightChecks();
  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  const when = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  els.preflightSub.textContent = `GM only. Last run ${when}.`;
  els.preflightSummary.hidden = false;
  els.preflightSummary.className = `preflight-summary ${fails > 0 ? 'pf-fail' : warns > 0 ? 'pf-warn' : 'pf-ok'}`;
  els.preflightSummary.textContent =
    fails > 0
      ? `Not ready: ${fails} to fix${warns > 0 ? `, ${warns} to look at` : ''}.`
      : warns > 0
        ? `Ready, with ${warns} to look at.`
        : 'Ready for the session.';
  els.preflightAuto.innerHTML = checks.map(preflightItem).join('');
  els.preflightFindings.innerHTML = preflightFindings(r.scan);
}
function renderPreflightManual() {
  const ticks = readPreflightTicks();
  els.preflightManual.innerHTML = PREFLIGHT_MANUAL.map(
    ([id, text]) => `<li class="preflight-item">
        <label class="pf-manual"><input type="checkbox" data-track="dash.preflight.manual-tick" data-tick="${escapeHtml(id)}" ${ticks[id] ? 'checked' : ''} />
        <span>${escapeHtml(text)}</span></label>
      </li>`
  ).join('');
}

// --- Party drawer (GM only; I-079) ---
// get-party (read) fills it; each action is a plan-party-change plan applied with
// apply-planned-change (the confirm modal shows the diff; Undo is in Recent Changes). No AI.
let partyState = null;
let partyGroupId = null;
let partyLoading = false;

function openParty() {
  usage.trackView('dash.party.view');
  els.drawerBackdrop.hidden = false;
  els.partyDrawer.hidden = false;
  void loadParty();
}
function closeParty() {
  usage.endView('dash.party.view');
  els.partyDrawer.hidden = true;
  if (
    els.drawer.hidden &&
    els.tarokkaDrawer.hidden &&
    els.preflightDrawer.hidden &&
    els.handoutsDrawer.hidden &&
    els.prepDrawer.hidden
  ) {
    els.drawerBackdrop.hidden = true;
  }
}
function clearPartySections() {
  els.partyWarnings.innerHTML = '';
  els.partyActions.hidden = true;
}
async function loadParty() {
  if (partyLoading) return;
  partyLoading = true;
  els.partyRefresh.disabled = true;
  els.partySub.textContent = 'Loading…';
  try {
    const state = await callReadTool('get-party', {});
    if (!state || typeof state !== 'object') throw new Error('The bridge sent no party.');
    partyState = state;
    renderParty();
  } catch (err) {
    els.partySub.textContent = 'GM only. The party did not load.';
    clearPartySections();
    els.partyMembers.innerHTML = `<p class="empty">Couldn't load the party: ${escapeHtml(String(err.message || err))}</p>`;
  } finally {
    partyLoading = false;
    els.partyRefresh.disabled = false;
  }
}
function currentPartyGroup() {
  const groups = (partyState && Array.isArray(partyState.groups) && partyState.groups) || [];
  return groups.find(g => g.actorId === partyGroupId) || groups[0] || null;
}
function partyMemberRow(m, sceneName) {
  const facts = [];
  if (m.level != null) facts.push(`Level ${m.level}`);
  if (m.ac != null) facts.push(`AC ${m.ac}`);
  if (m.passivePerception != null) facts.push(`Passive Perception ${m.passivePerception}`);
  if (m.hitDice) facts.push(`Hit dice ${m.hitDice.value}/${m.hitDice.max}`);
  const chips = (Array.isArray(m.conditions) ? m.conditions : []).map(
    c => `<span class="condition-chip">${escapeHtml(c)}</span>`
  );
  if (m.exhaustion > 0) {
    chips.unshift(
      `<span class="condition-chip">Exhaustion ${escapeHtml(String(m.exhaustion))}</span>`
    );
  }
  const tokens = Array.isArray(m.tokens) ? m.tokens : [];
  let tokenText = sceneName ? `No token on ${sceneName}` : '';
  if (tokens.length > 0) {
    const inCombat = tokens.some(t => t.inCombat) ? ', in the encounter' : '';
    const hidden = tokens.some(t => t.hidden) ? ', hidden' : '';
    tokenText = `On ${sceneName}${hidden}${inCombat}`;
  }
  let hp = '';
  if (m.hp && m.hp.max > 0) {
    const ratio = m.hp.value / m.hp.max;
    const temp = m.hp.temp > 0 ? ` +${m.hp.temp}` : '';
    hp = `<div class="hp party-hp">
        <div class="hp-text">${escapeHtml(`${m.hp.value}/${m.hp.max}${temp}`)}</div>
        <div class="hp-bar"><div class="hp-fill ${hpClass(ratio)}" style="width:${Math.max(0, Math.min(100, ratio * 100))}%"></div></div>
      </div>`;
  }
  const death = m.deathSaves
    ? `<div class="death-saves">Death saves: ${escapeHtml(String(m.deathSaves.success))} saved, ${escapeHtml(String(m.deathSaves.failure))} failed</div>`
    : '';
  const star = m.inspiration ? ' <span class="party-inspiration" title="Inspiration">★</span>' : '';
  return `<li class="preflight-item party-member">
      <span class="pf-text">
        <span class="pf-label">${escapeHtml(m.name)}${star}</span>
        <span class="pf-detail">${escapeHtml(facts.join(' · '))}</span>
        ${chips.length > 0 ? `<div class="conditions">${chips.join('')}</div>` : ''}
        ${death}
        ${tokenText ? `<span class="pf-detail">${escapeHtml(tokenText)}</span>` : ''}
      </span>
      ${hp}
      <button type="button" class="btn btn-small" data-track="dash.party.open-actor" data-party-open="${escapeHtml(m.uuid)}">Open</button>
    </li>`;
}
function partyPaceSection(g) {
  const options =
    (partyState && Array.isArray(partyState.paceOptions) && partyState.paceOptions) || [];
  const pace = g.pace;
  if (!pace) return '<p class="pf-detail">This group has no travel pace.</p>';
  const slowed = pace.slowed ? '. A slowed member holds the party to slow pace.' : '';
  const current = `<p class="pf-detail">Now: <strong>${escapeHtml(pace.label)}</strong>${slowed}</p>`;
  if (options.length === 0) return current;
  const buttons = options
    .map(
      o =>
        `<button type="button" class="btn btn-small" data-track="dash.party.pace" data-party-pace="${escapeHtml(o.value)}"${
          o.value === pace.value && !pace.slowed ? ' disabled' : ''
        }>${escapeHtml(o.label)}</button>`
    )
    .join('');
  return `${current}<div class="party-buttons">${buttons}</div>`;
}
function partyCombatSection(g) {
  const s = partyState;
  if (!s.scene) return '<p class="pf-detail">No active scene.</p>';
  const sceneName = s.scene.name || 'the scene';
  const tokens = g.members.flatMap(m => (Array.isArray(m.tokens) ? m.tokens : []));
  const toAdd = tokens.filter(t => !t.inCombat).length;
  const where = s.encounter
    ? `Encounter on ${sceneName}, round ${s.encounter.round}${s.encounter.started ? '' : ' (not started)'}.`
    : `No encounter. The button starts one on ${sceneName}.`;
  let label = s.encounter ? `Add ${toAdd} to the encounter` : `Start an encounter with ${toAdd}`;
  if (tokens.length === 0) label = `No party tokens on ${sceneName}`;
  else if (toAdd === 0) label = 'Everyone is in the encounter';
  return `<p class="pf-detail">${escapeHtml(where)}</p>
    <div class="party-buttons"><button type="button" class="btn btn-small" data-track="dash.party.add-to-combat" data-party-combat${
      toAdd === 0 ? ' disabled' : ''
    }>${escapeHtml(label)}</button></div>`;
}
function partyRestSection(g) {
  const cards = g.restCards || {};
  const disabled = type => (cards[type] ? '' : ' disabled');
  return `<p class="pf-detail">Posts dnd5e's rest card to chat; each player clicks it to rest their character. Undo removes the card while nobody has used it.</p>
    <div class="party-buttons">
      <button type="button" class="btn btn-small" data-track="dash.party.rest-short" data-party-rest="short"${disabled('short')}>Short rest request</button>
      <button type="button" class="btn btn-small" data-track="dash.party.rest-long" data-party-rest="long"${disabled('long')}>Long rest request</button>
    </div>`;
}
function renderParty() {
  const s = partyState;
  if (!s) return;
  const groups = Array.isArray(s.groups) ? s.groups : [];
  const g = currentPartyGroup();
  els.partyGroup.hidden = groups.length < 2;
  els.partyGroup.innerHTML = groups
    .map(
      x =>
        `<option value="${escapeHtml(x.actorId)}"${g && x.actorId === g.actorId ? ' selected' : ''}>${escapeHtml(
          x.name + (x.primary ? ' (primary)' : '')
        )}</option>`
    )
    .join('');
  const warnings = Array.isArray(s.warnings) ? s.warnings : [];
  els.partyWarnings.innerHTML = warnings
    .map(w => `<div class="preflight-summary pf-warn">${escapeHtml(w)}</div>`)
    .join('');
  if (!g) {
    els.partySub.textContent = 'GM only. No party yet.';
    els.partyMembers.innerHTML =
      '<p class="empty">No party yet. In Foundry, create an Actor of type Group, drag the characters onto it, then right-click it in the Actors tab and set it as the primary party.</p>';
    els.partyActions.hidden = true;
    return;
  }
  els.partyActions.hidden = false;
  const members = Array.isArray(g.members) ? g.members : [];
  const primary = g.primary ? '' : ' Not the primary party.';
  const count = `${members.length} ${members.length === 1 ? 'member' : 'members'}`;
  els.partySub.textContent = `GM only. ${g.name}, level ${g.level}, ${count}.${primary}`;
  const sceneName = s.scene ? s.scene.name : '';
  els.partyMembers.innerHTML =
    members.length > 0
      ? `<ul class="preflight-list">${members.map(m => partyMemberRow(m, sceneName)).join('')}</ul>`
      : '<p class="empty">The group has no members. Drag characters onto it in Foundry.</p>';
  els.partyPace.innerHTML = partyPaceSection(g);
  els.partyCombat.innerHTML = partyCombatSection(g);
  els.partyRest.innerHTML = partyRestSection(g);
}
async function partyAction(args) {
  const g = currentPartyGroup();
  if (!g) return;
  await planThenApply('plan-party-change', { ...args, groupId: g.actorId });
}
async function onPartyClick(e) {
  const open = e.target.closest('[data-party-open]');
  if (open) {
    try {
      await callReadTool('open-in-foundry', { uuid: open.dataset.partyOpen });
      toast('Opened in Foundry', 'ok');
    } catch (err) {
      toast(`✗ open-in-foundry: ${String(err.message || err)}`, 'err');
    }
    return;
  }
  const pace = e.target.closest('[data-party-pace]');
  if (pace) {
    await partyAction({ action: 'pace', pace: pace.dataset.partyPace });
    return;
  }
  if (e.target.closest('[data-party-combat]')) {
    await partyAction({ action: 'add-to-combat' });
    return;
  }
  const rest = e.target.closest('[data-party-rest]');
  if (rest) await partyAction({ action: 'rest-request', rest: rest.dataset.partyRest });
}

// --- Tarokka drawer (GM only) ---
// A plan-* tool is a read; apply-planned-change then shows its diff in the
// confirm modal (and the destructive checkbox for a reveal).
async function planThenApply(planTool, args) {
  let plan;
  try {
    plan = await callReadTool(planTool, args);
  } catch (err) {
    usage.trackTool(planTool, 'error', toolErrorCode(err));
    toast(`✗ ${planTool}: ${String(err.message || err)}`, 'err');
    return;
  }
  usage.trackTool(planTool, 'ok');
  if (plan && plan.providerNote) toast(plan.providerNote, 'warn');
  await runTool('apply-planned-change', { planId: plan.planId }, 'write');
}
function openTarokka() {
  usage.trackView('dash.tarokka.view');
  els.drawerBackdrop.hidden = false;
  els.tarokkaDrawer.hidden = false;
  void loadTarokka();
}
function closeTarokka() {
  usage.endView('dash.tarokka.view');
  els.tarokkaDrawer.hidden = true;
  if (
    els.drawer.hidden &&
    els.preflightDrawer.hidden &&
    els.handoutsDrawer.hidden &&
    els.prepDrawer.hidden &&
    els.partyDrawer.hidden
  ) {
    els.drawerBackdrop.hidden = true;
  }
}
async function loadTarokka() {
  try {
    tarokkaView = await callReadTool('get-tarokka-reading', {});
    renderTarokka();
  } catch (err) {
    els.tarokkaBody.innerHTML = `<p class="empty">Couldn't load the reading: ${escapeHtml(String(err.message || err))}</p>`;
  }
}
const LINK_LABELS = { journalPageUuid: 'Journal', sceneUuid: 'Scene', actorUuid: 'Actor' };
function renderTarokka() {
  const v = tarokkaView;
  const show = els.tarokkaShow.checked;
  if (!v || !v.available || !v.reading) {
    els.tarokkaSub.textContent = 'GM only. No reading stored yet.';
    els.tarokkaBody.innerHTML =
      '<p class="empty">No reading in the vault. Import one from tarokka-reading or deal a new one.</p>';
    return;
  }
  const r = v.reading;
  els.tarokkaSub.textContent = `GM only · ${r.source} · ${new Date(r.readAt).toLocaleString()} · ${v.archivedReadings} archived`;
  els.tarokkaBody.innerHTML = r.positions
    .map(p => {
      const links = Object.entries(p.links || {})
        .map(
          ([key, uuid]) =>
            `<button type="button" class="btn btn-small" data-track="dash.tarokka.open-document" data-open="${escapeHtml(uuid)}">Open ${escapeHtml(LINK_LABELS[key] || key)}</button>`
        )
        .join('');
      const revealed = p.revealed
        ? `<span class="tarokka-badge revealed">revealed</span>${p.revealPageUuid ? `<button type="button" class="btn btn-small" data-track="dash.tarokka.open-document" data-open="${escapeHtml(p.revealPageUuid)}">Open page</button>` : ''}`
        : '<span class="tarokka-badge">hidden from players</span>';
      return `
        <div class="tarokka-pos" data-position="${escapeHtml(p.position)}">
          <div class="tarokka-pos-head">
            <span class="tarokka-label">${escapeHtml(p.label)}</span>
            <span class="tarokka-card ${show ? '' : 'veiled'}" title="${show ? '' : 'Tick “Show cards” to see it'}">${escapeHtml(p.cardName)} <code>${escapeHtml(p.cardId)}</code></span>
          </div>
          ${p.gmNote && show ? `<div class="tarokka-note">${escapeHtml(p.gmNote)}</div>` : ''}
          <div class="tarokka-row">${links || '<span class="tarokka-badge warn">not linked</span>'} ${revealed}</div>
          <div class="tarokka-row">
            <button type="button" class="btn btn-small" data-track="dash.tarokka.link" data-link-search="${escapeHtml(p.position)}">Link…</button>
            <button type="button" class="btn btn-small" data-track="dash.tarokka.reveal" data-reveal="${escapeHtml(p.position)}">Reveal…</button>
          </div>
          <div class="tarokka-form" data-form="${escapeHtml(p.position)}" hidden></div>
        </div>`;
    })
    .join('');
}
function tarokkaForm(position) {
  return els.tarokkaBody.querySelector(`[data-form="${CSS.escape(position)}"]`);
}
function showLinkSearch(position) {
  const form = tarokkaForm(position);
  form.hidden = false;
  form.innerHTML = `
    <input class="field-control" type="text" placeholder="Search journals, pages, scenes, actors…" data-link-query />
    <button type="button" class="btn btn-small" data-track="dash.tarokka.link-search" data-link-go="${escapeHtml(position)}">Search</button>
    <div class="tarokka-candidates"></div>`;
  form.querySelector('[data-link-query]').focus();
}
async function runLinkSearch(position) {
  const form = tarokkaForm(position);
  const query = form.querySelector('[data-link-query]').value.trim();
  const list = form.querySelector('.tarokka-candidates');
  try {
    const result = await callReadTool('suggest-tarokka-links', { query, limit: 20 });
    const candidates = (result && result.candidates) || [];
    list.innerHTML = candidates.length
      ? candidates
          .map(
            c =>
              `<div class="tarokka-candidate"><span>${escapeHtml(c.documentName)}: ${escapeHtml(c.name)}${c.parentName ? ` <em>(${escapeHtml(c.parentName)})</em>` : ''}</span><button type="button" class="btn btn-small" data-track="dash.tarokka.link-pick" data-link-pick="${escapeHtml(position)}" data-uuid="${escapeHtml(c.uuid)}" data-doc="${escapeHtml(c.documentName)}">Link</button></div>`
          )
          .join('')
      : '<p class="empty">No matches.</p>';
  } catch (err) {
    list.innerHTML = `<p class="empty">${escapeHtml(String(err.message || err))}</p>`;
  }
}
function linkField(documentName) {
  if (documentName === 'Scene') return 'sceneUuid';
  if (documentName === 'Actor') return 'actorUuid';
  return 'journalPageUuid';
}
function showRevealForm(position) {
  const form = tarokkaForm(position);
  form.hidden = false;
  form.innerHTML = `
    <input class="field-control" type="text" placeholder="Page title (optional)" data-reveal-title />
    <textarea class="field-control" rows="4" placeholder="Exactly what the players may read" data-reveal-text></textarea>
    <button type="button" class="btn btn-small" data-track="dash.tarokka.plan-reveal" data-reveal-go="${escapeHtml(position)}">Plan reveal…</button>`;
  form.querySelector('[data-reveal-text]').focus();
}
async function onTarokkaClick(e) {
  const open = e.target.closest('[data-open]');
  if (open) {
    try {
      await callReadTool('open-in-foundry', { uuid: open.dataset.open });
      toast('Opened in Foundry', 'ok');
    } catch (err) {
      toast(`✗ open-in-foundry: ${String(err.message || err)}`, 'err');
    }
    return;
  }
  const search = e.target.closest('[data-link-search]');
  if (search) return showLinkSearch(search.dataset.linkSearch);
  const go = e.target.closest('[data-link-go]');
  if (go) return runLinkSearch(go.dataset.linkGo);
  const pick = e.target.closest('[data-link-pick]');
  if (pick) {
    return planThenApply('plan-tarokka-links', {
      position: pick.dataset.linkPick,
      [linkField(pick.dataset.doc)]: pick.dataset.uuid,
    });
  }
  const reveal = e.target.closest('[data-reveal]');
  if (reveal) return showRevealForm(reveal.dataset.reveal);
  const revealGo = e.target.closest('[data-reveal-go]');
  if (revealGo) {
    const form = tarokkaForm(revealGo.dataset.revealGo);
    const text = form.querySelector('[data-reveal-text]').value.trim();
    const title = form.querySelector('[data-reveal-title]').value.trim();
    if (!text) {
      toast('Write the text the players will read first.', 'warn');
      return;
    }
    return planThenApply('plan-tarokka-reveal', {
      position: revealGo.dataset.revealGo,
      text,
      ...(title ? { title } : {}),
    });
  }
}

// --- Wiring ---
els.btnGm.addEventListener('click', () => {
  postJson('/api/control', { action: 'toggle-gm-actions' }).catch(() => {});
});
els.btnTools.addEventListener('click', () => {
  openDrawer();
  showBrowser();
});
els.drawerClose.addEventListener('click', closeDrawer);
els.drawerBackdrop.addEventListener('click', closeDrawer);
els.gmGateEnable.addEventListener('click', () => {
  postJson('/api/control', { action: 'set-gm-actions', value: true }).catch(() => {});
});
els.toolSearch.addEventListener('input', () => renderToolList(els.toolSearch.value));
els.toolBack.addEventListener('click', showBrowser);
els.toolList.addEventListener('click', e => {
  const b = e.target.closest('[data-tool]');
  if (b) void openTool(b.dataset.tool);
});
els.combatBody.addEventListener('click', e => {
  const reaction = e.target.closest('[data-reaction]');
  if (reaction) {
    const id = reaction.dataset.reaction;
    if (reactionsUsed.has(id)) reactionsUsed.delete(id);
    else reactionsUsed.add(id);
    renderCombat(lastCombat);
    return;
  }
  if (!settings.gmActionsEnabled) return;
  const row = e.target.closest('.combatant');
  if (!row || !row.dataset.id) return;
  const id = row.dataset.id;
  if (selectedCombatants.has(id)) selectedCombatants.delete(id);
  else selectedCombatants.add(id);
  row.classList.toggle('selected');
  renderCombatActions();
});
els.combatActions.addEventListener('click', e => {
  const initBtn = e.target.closest('[data-init]');
  if (initBtn) {
    void runTool('roll-initiative-for-npcs', { scope: initBtn.dataset.init }, 'write');
    return;
  }
  if (e.target.closest('[data-advance]')) {
    void runTool('advance-combat-turn', {}, 'write');
    return;
  }
  const selBtn = e.target.closest('[data-sel]');
  if (!selBtn) return;
  const action = selBtn.dataset.sel;
  if (action === 'clear') {
    selectedCombatants.clear();
    renderCombat(lastCombat);
    return;
  }
  if (action === 'init') {
    if (selectedCombatants.size === 0) return;
    void runTool('roll-initiative-for-npcs', { combatantIds: [...selectedCombatants] }, 'write');
    return;
  }
  const names = selectedNames();
  if (names.length === 0) return;
  if (action === 'damage') void openTool('apply-damage-and-healing', { targets: names });
  if (action === 'save') void openTool('roll-saving-throws', { targets: names });
});
els.changesRefresh.addEventListener('click', () => void loadRecentChanges());
els.bossToggle.addEventListener('click', () => setBossPrompts(!bossPrompts));
els.btnSession.addEventListener(
  'click',
  () => void markSession(playSession.open ? 'end' : 'start')
);
els.btnTarokka.addEventListener('click', openTarokka);
els.tarokkaClose.addEventListener('click', closeTarokka);
els.drawerBackdrop.addEventListener('click', closeTarokka);
els.tarokkaRefresh.addEventListener('click', () => void loadTarokka());
els.tarokkaShow.addEventListener('change', renderTarokka);
els.tarokkaImport.addEventListener('click', () =>
  planThenApply('plan-tarokka-import', { source: 'tarokka-reading' })
);
els.tarokkaRoll.addEventListener('click', () =>
  planThenApply('plan-tarokka-import', { source: 'builtin-roll' })
);
els.tarokkaBody.addEventListener('click', e => void onTarokkaClick(e));
els.btnPrep.addEventListener('click', openPrep);
els.prepClose.addEventListener('click', closePrep);
els.drawerBackdrop.addEventListener('click', closePrep);
els.prepRefresh.addEventListener('click', () => void loadPrep());
els.prepDrawer.addEventListener('click', e => void onPrepClick(e));
els.btnParty.addEventListener('click', openParty);
els.partyClose.addEventListener('click', closeParty);
els.drawerBackdrop.addEventListener('click', closeParty);
els.partyRefresh.addEventListener('click', () => void loadParty());
els.partyGroup.addEventListener('change', () => {
  partyGroupId = els.partyGroup.value || null;
  renderParty();
});
els.partyDrawer.addEventListener('click', e => void onPartyClick(e));
els.btnHandouts.addEventListener('click', openHandouts);
els.handoutsClose.addEventListener('click', closeHandouts);
els.drawerBackdrop.addEventListener('click', closeHandouts);
els.handoutsRefresh.addEventListener('click', () => void loadHandouts());
els.handoutsNext.addEventListener('click', () => void revealNextHandout());
els.handoutsAdd.addEventListener('click', () => {
  closeHandouts();
  openDrawer();
  void openTool('plan-page-reveal', {
    action: 'queue',
    ...(activeSceneId ? { sceneId: activeSceneId } : {}),
  });
});
els.handoutsQueue.addEventListener('click', e => {
  const btn = e.target.closest('[data-unqueue]');
  if (btn) void unqueueHandout(btn.dataset.unqueue);
});
els.btnPreflight.addEventListener('click', openPreflight);
els.preflightClose.addEventListener('click', closePreflight);
els.drawerBackdrop.addEventListener('click', closePreflight);
els.preflightRun.addEventListener('click', () => void runPreflight());
els.preflightClear.addEventListener('click', () => {
  writePreflightTicks({});
  renderPreflightManual();
});
els.preflightManual.addEventListener('change', e => {
  const box = e.target.closest('[data-tick]');
  if (!box) return;
  const ticks = readPreflightTicks();
  if (box.checked) ticks[box.dataset.tick] = Date.now();
  else delete ticks[box.dataset.tick];
  writePreflightTicks(ticks);
});
els.tarokkaShow.addEventListener('change', () => {
  renderPreflightButton();
  if (!els.preflightDrawer.hidden) renderPreflight();
});
els.changesBody.addEventListener('click', e => {
  const btn = e.target.closest('[data-undo]');
  if (!btn) return;
  const change = recentChanges.find(c => c.changeId === btn.dataset.undo);
  if (!change) return;
  void runTool('undo-change', { changeId: change.changeId }, 'destructive', {
    diff: change.diff || [],
    summary: `Undo: ${change.summary}`,
  });
});
els.modalCancel.addEventListener('click', () => closeModal(false));
els.modalConfirm.addEventListener('click', () => closeModal(true));
els.modalBackdrop.addEventListener('click', e => {
  if (e.target === els.modalBackdrop) closeModal(false);
});
els.modalDestructiveCheck.addEventListener('change', () => {
  els.modalConfirm.disabled = !els.modalDestructiveCheck.checked;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!els.modalBackdrop.hidden) {
    usage.trackShortcut('dash.shortcut.escape-modal');
    closeModal(false);
  } else if (!els.prepDrawer.hidden) {
    usage.trackShortcut('dash.shortcut.escape-prep');
    closePrep();
  } else if (!els.partyDrawer.hidden) {
    usage.trackShortcut('dash.shortcut.escape-party');
    closeParty();
  } else if (!els.handoutsDrawer.hidden) {
    usage.trackShortcut('dash.shortcut.escape-handouts');
    closeHandouts();
  } else if (!els.preflightDrawer.hidden) {
    usage.trackShortcut('dash.shortcut.escape-preflight');
    closePreflight();
  } else if (!els.tarokkaDrawer.hidden) {
    usage.trackShortcut('dash.shortcut.escape-tarokka');
    closeTarokka();
  } else if (!els.drawer.hidden) {
    usage.trackShortcut('dash.shortcut.escape-tools');
    closeDrawer();
  }
});

connect();
usage.trackView('dash.main.view');
renderSessionControl();
void loadPlaySession();
setInterval(() => void loadPlaySession(), 60000);
