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

const els = {
  worldSubtitle: $('world-subtitle'),
  statusBridge: $('status-bridge'),
  statusFoundry: $('status-foundry'),
  statusAi: $('status-ai'),
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
  // Recent guarded changes
  changesBody: $('changes-body'),
  changesMeta: $('changes-meta'),
  changesRefresh: $('changes-refresh'),
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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function setDot(pill, cls, label) {
  pill.innerHTML = `<span class="dot ${cls}"></span> ${label}`;
}

let foundryLive = false;
function renderStatus(status) {
  if (status.controlChannel === 'connected') {
    setDot(els.statusBridge, 'dot-green', 'Bridge: connected');
  } else {
    setDot(els.statusBridge, 'dot-red', 'Bridge: disconnected');
  }

  if (status.foundry === 'reachable') {
    setDot(els.statusFoundry, 'dot-green', 'Foundry: live');
    if (!foundryLive) scheduleChangesReload();
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
}

function renderWorld(world) {
  if (!world) return;
  els.worldSubtitle.textContent = `${world.title} · ${world.systemId} ${world.systemVersion} · Foundry ${world.foundryVersion}`;
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

function renderCombat(combat) {
  lastCombat = combat;
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
        <div class="${combatantClasses(c)}" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">
          <div class="init-badge">${init}</div>
          <div class="combatant-main">
            <div class="combatant-name">${escapeHtml(c.name)} ${sideTag(c)}</div>
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
        <button type="button" class="ca-btn" data-init="npcs">NPCs</button>
        <button type="button" class="ca-btn" data-init="all">All</button>
        <button type="button" class="ca-btn" data-init="missing">Missing</button>
      </div>
      <button type="button" class="ca-btn" data-advance>⏭ Advance turn</button>
    </div>${
      n > 0
        ? `
    <div class="ca-row ca-selection">
      <span class="ca-count"><strong>${n}</strong> selected</span>
      <button type="button" class="ca-btn" data-sel="init">Roll init</button>
      <button type="button" class="ca-btn" data-sel="damage">Damage / Heal</button>
      <button type="button" class="ca-btn" data-sel="save">Roll save</button>
      <button type="button" class="ca-btn ghost" data-sel="clear">Clear</button>
    </div>`
        : ''
    }`;
}

// ---------------------------------------------------------------------------
// Event feed (newest on top)
// ---------------------------------------------------------------------------
function addEvents(events) {
  if (!events || events.length === 0) return;
  if (els.feedBody.querySelector('.empty')) els.feedBody.innerHTML = '';

  // events arrive oldest-first; prepend each so newest ends up on top.
  for (const ev of events) {
    if (seenEventIds.has(ev.id)) continue;
    seenEventIds.add(ev.id);
    eventCount += 1;

    const time = new Date(ev.timestampMs).toLocaleTimeString();
    const node = document.createElement('div');
    node.className = `event sev-${ev.eventType}`;
    node.innerHTML = `
      <div class="event-desc">${escapeHtml(ev.description)}</div>
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
    postBtn.disabled = true;
    postBtn.textContent = 'Posting…';
    postJson('/api/post-chat', { text: c.text })
      .then(() => {
        postBtn.textContent = '✓ Whispered to GM';
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

function toast(msg, kind = 'ok') {
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
  updateGate();
  if (!toolsLoaded) void loadTools();
}
function closeDrawer() {
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
        <button type="button" class="tool-item" data-tool="${escapeHtml(t.name)}">
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
      item.addEventListener('click', () => pick(choice));
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

  open.addEventListener('click', () => (menu.hidden ? show() : close()));
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

// --- Run a tool (confirm-gated for writes) ---
async function runTool(name, args, mutates, opts = {}) {
  const found = findTool(name);
  let kind = mutates || (found && found.mutates) || 'write';
  let confirmFlags = {};
  let diff = opts.diff;
  let summary = opts.summary;
  if (kind !== 'read') {
    if (!settings.gmActionsEnabled) {
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
    if (!ok) return;
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
      toast(`✓ ${name}`, 'ok');
      if (opts.showResultInDrawer) showToolResult(true, data.result);
      if (name === 'apply-planned-change' || name === 'undo-change') {
        scheduleChangesReload();
        if (!els.tarokkaDrawer.hidden) void loadTarokka();
      }
      return data;
    }
    const msg = data.error || `HTTP ${res.status}`;
    if (res.status === 403) {
      toast('GM Actions are off — enable them first.', 'warn');
      openDrawer();
    } else {
      toast(`✗ ${name}: ${msg}`, 'err');
    }
    if (opts.showResultInDrawer) showToolResult(false, msg);
  } catch (err) {
    const msg = String(err.message || err);
    toast(`✗ ${name}: ${msg}`, 'err');
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
        ? `<button type="button" class="btn btn-small" data-undo="${escapeHtml(c.changeId)}">Undo</button>`
        : '';
      const details = diff
        ? `<details><summary>${lines.length} line(s)</summary><ul class="change-diff">${diff}</ul></details>`
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
          </div>
          ${details}
        </div>`;
    })
    .join('');
}

// --- Tarokka drawer (GM only) ---
// A plan-* tool is a read; apply-planned-change then shows its diff in the
// confirm modal (and the destructive checkbox for a reveal).
async function planThenApply(planTool, args) {
  let plan;
  try {
    plan = await callReadTool(planTool, args);
  } catch (err) {
    toast(`✗ ${planTool}: ${String(err.message || err)}`, 'err');
    return;
  }
  if (plan && plan.providerNote) toast(plan.providerNote, 'warn');
  await runTool('apply-planned-change', { planId: plan.planId }, 'write');
}
function openTarokka() {
  els.drawerBackdrop.hidden = false;
  els.tarokkaDrawer.hidden = false;
  void loadTarokka();
}
function closeTarokka() {
  els.tarokkaDrawer.hidden = true;
  if (els.drawer.hidden) els.drawerBackdrop.hidden = true;
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
            `<button type="button" class="btn btn-small" data-open="${escapeHtml(uuid)}">Open ${escapeHtml(LINK_LABELS[key] || key)}</button>`
        )
        .join('');
      const revealed = p.revealed
        ? `<span class="tarokka-badge revealed">revealed</span>${p.revealPageUuid ? `<button type="button" class="btn btn-small" data-open="${escapeHtml(p.revealPageUuid)}">Open page</button>` : ''}`
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
            <button type="button" class="btn btn-small" data-link-search="${escapeHtml(p.position)}">Link…</button>
            <button type="button" class="btn btn-small" data-reveal="${escapeHtml(p.position)}">Reveal…</button>
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
    <button type="button" class="btn btn-small" data-link-go="${escapeHtml(position)}">Search</button>
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
              `<div class="tarokka-candidate"><span>${escapeHtml(c.documentName)}: ${escapeHtml(c.name)}${c.parentName ? ` <em>(${escapeHtml(c.parentName)})</em>` : ''}</span><button type="button" class="btn btn-small" data-link-pick="${escapeHtml(position)}" data-uuid="${escapeHtml(c.uuid)}" data-doc="${escapeHtml(c.documentName)}">Link</button></div>`
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
    <button type="button" class="btn btn-small" data-reveal-go="${escapeHtml(position)}">Plan reveal…</button>`;
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
  if (!els.modalBackdrop.hidden) closeModal(false);
  else if (!els.tarokkaDrawer.hidden) closeTarokka();
  else if (!els.drawer.hidden) closeDrawer();
});

connect();
