// Read-only player view (M2). It reads the dedicated player stream
// (/api/player/stream), which carries only the projected player state built on
// the server (player/projection.ts): names as players see them, no enemy HP
// numbers, core conditions only, public rolls only, and handouts whose HTML the
// server already sanitized. A GM credential in this browser changes nothing:
// the player endpoints always project. This page filters nothing itself.

// Optional player token (only if the deployment sets PLAYER_DASHBOARD_TOKEN).
// Kept under its own key, never the GM page's.
const TOKEN_KEY = 'cogm_player_token';
const TOKEN = (() => {
  const fromUrl = new URL(location.href).searchParams.get('token');
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {}
    return fromUrl;
  }
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
})();
const streamUrl = '/api/player/stream' + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '');

const $ = id => document.getElementById(id);

// Usage log (I-084, usage.js): fixed control names only. The page works without it.
const noop = () => {};
const usage = window.cogmUsage || {
  track: noop,
  trackView: noop,
  endView: noop,
  setWho: noop,
};
const elStatus = $('status');
const elWorld = $('world');
const elScene = $('scene');
const elCombat = $('combat');
const elFeed = $('feed');
const elHandouts = $('handouts');
const elWho = $('who');
const elWhoName = $('who-name');
const elWhoChange = $('who-change');
const elWhoPicker = $('who-picker');
const elWhoList = $('who-list');

const escape = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const STATUS_LABELS = {
  live: 'live',
  'foundry-offline': 'foundry offline',
  disconnected: 'disconnected',
  connecting: 'connecting…',
};

function hpCell(c) {
  if (c.isPC && c.hp) {
    const pct = c.hp.max ? Math.max(0, Math.min(100, (100 * c.hp.value) / c.hp.max)) : 0;
    return `<span class="hpbar"><i style="width:${pct}%"></i></span>`;
  }
  // Enemy/NPC: never numbers. A coarse band if the server provided one.
  if (c.hpBand) return `<span class="hp-muted">${escape(c.hpBand)}</span>`;
  return `<span class="hp-muted">—</span>`;
}

function renderCombat(combat) {
  if (!combat || !combat.active || !combat.combatants || combat.combatants.length === 0) {
    elCombat.innerHTML = '<div class="empty">No active combat.</div>';
    return;
  }
  const rows = combat.combatants
    .map(c => {
      const cls = ['row'];
      if (c.isCurrentTurn) cls.push('current');
      if (c.defeated) cls.push('defeated');
      const conds =
        c.conditions && c.conditions.length
          ? `<span class="cond">${c.conditions.map(escape).join(', ')}</span>`
          : '';
      return `<div class="${cls.join(' ')}">
        <span class="init">${escape(c.initiative ?? '—')}</span>
        <span class="dot ${escape(c.side)}"></span>
        <span class="name">${escape(c.name)}</span>
        ${conds}
        ${hpCell(c)}
      </div>`;
    })
    .join('');
  elCombat.innerHTML =
    `<div class="sub" style="padding:4px 8px">Round ${escape(combat.round)}</div>` + rows;
}

function renderFeed(events) {
  if (!events || events.length === 0) {
    elFeed.innerHTML = '<div class="empty">Waiting for events…</div>';
    return;
  }
  elFeed.innerHTML = events
    .slice()
    .reverse()
    .map(e => {
      const t = new Date(e.timestampMs).toLocaleTimeString();
      return `<div class="event"><span class="t">${escape(t)}</span>${escape(e.text)}</div>`;
    })
    .join('');
}

function renderState(s) {
  elStatus.textContent = STATUS_LABELS[s.status] || 'connecting…';
  elWorld.textContent = s.world
    ? `${s.world.title}${s.world.systemId ? ' · ' + s.world.systemId : ''}`
    : '—';
  elScene.textContent = s.scene ? `· ${s.scene}` : '';
  renderCombat(s.combat);
  renderFeed(s.events);
}

function renderHandouts(handouts) {
  if (!handouts || handouts.length === 0) {
    elHandouts.innerHTML = '<div class="empty">Nothing revealed yet.</div>';
    return;
  }
  // `html` was rebuilt server-side from an allowlist (no attributes, no scripts).
  elHandouts.innerHTML = handouts
    .map(
      h => `<details class="handout"><summary data-track="player.handouts.open">${escape(h.title)}</summary>
        <div class="content">${h.html}</div></details>`
    )
    .join('');
}

function connect() {
  const es = new EventSource(streamUrl);
  const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));
  on('state', renderState);
  on('handouts', p => renderHandouts(p.handouts));
  es.onerror = () => {
    elStatus.textContent = 'reconnecting…';
  };
}

// --- Who is this? (one-time name pick for the usage log) ------------------------
// The names come from GET /api/player/names (players only, never a GM). The pick is a claim the
// server checks against that list; it only tells the usage log which friend used which control.
const WHO_KEY = 'cogm_player_who';

function readWho() {
  try {
    const raw = JSON.parse(localStorage.getItem(WHO_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return {
        userId: typeof raw.userId === 'string' ? raw.userId : null,
        name: typeof raw.name === 'string' ? raw.name : null,
      };
    }
  } catch {}
  return null;
}

function saveWho(who) {
  try {
    if (who) localStorage.setItem(WHO_KEY, JSON.stringify(who));
    else localStorage.removeItem(WHO_KEY);
  } catch {}
}

function showWho(who) {
  usage.setWho(who);
  elWhoPicker.hidden = true;
  elWho.hidden = false;
  elWhoName.textContent = who && who.name ? `Playing as ${who.name}` : '';
  elWhoChange.textContent = who && who.name ? 'not you?' : 'pick your name';
}

async function loadNames() {
  try {
    const res = await fetch('/api/player/names', {
      headers: TOKEN ? { 'X-CoGM-Token': TOKEN } : {},
    });
    if (!res.ok) return [];
    const names = await res.json();
    return Array.isArray(names)
      ? names.filter(n => n && typeof n.userId === 'string' && typeof n.name === 'string')
      : [];
  } catch {
    return [];
  }
}

async function askWho() {
  const names = await loadNames();
  // Nobody known yet (the bridge has not seen the players): ask again next visit.
  if (names.length === 0) return;
  elWhoList.innerHTML = '';
  for (const n of names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-pick';
    b.textContent = n.name;
    b.addEventListener('click', () => {
      usage.track('action', 'player.who.pick');
      const who = { userId: n.userId, name: n.name };
      saveWho(who);
      showWho(who);
    });
    elWhoList.appendChild(b);
  }
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'who-pick';
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => {
    usage.track('action', 'player.who.skip');
    saveWho({ userId: null, name: null });
    showWho(null);
  });
  elWhoList.appendChild(skip);
  elWhoPicker.hidden = false;
}

elWhoChange.addEventListener('click', e => {
  e.preventDefault();
  saveWho(null);
  showWho(null);
  void askWho();
});

const storedWho = readWho();
if (storedWho) showWho(storedWho);
else void askWho();

connect();
usage.trackView('player.main.view');
