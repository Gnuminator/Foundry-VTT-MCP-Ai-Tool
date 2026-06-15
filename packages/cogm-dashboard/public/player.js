// Read-only player view. Consumes the SAME SSE stream as the GM dashboard, but
// the server filters it for the 'player' role before anything is written to this
// connection (see redact.ts): exact enemy HP, hidden combatants, GM notes,
// diagnostics, settings, and AI commentary never arrive here. This client just
// renders whatever the server sends — it performs no filtering of its own.

// Optional player token (only if the deployment sets PLAYER_DASHBOARD_TOKEN).
const TOKEN = (() => {
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
const streamUrl = '/api/stream' + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '');

const $ = id => document.getElementById(id);
const elStatus = $('status');
const elWorld = $('world');
const elCombat = $('combat');
const elFeed = $('feed');

const escape = s =>
  String(s ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

function renderStatus(s) {
  const fo = s.foundry;
  const label =
    s.controlChannel !== 'connected'
      ? 'disconnected'
      : fo === 'reachable'
        ? 'live'
        : fo === 'unreachable'
          ? 'foundry offline'
          : 'connecting…';
  elStatus.textContent = label;
}

function renderWorld(w) {
  elWorld.textContent = w ? `${w.title}${w.systemId ? ' · ' + w.systemId : ''}` : '—';
}

function hpCell(c) {
  if (c.isPC && c.hp) {
    const pct = c.hp.max ? Math.max(0, Math.min(100, (100 * c.hp.value) / c.hp.max)) : 0;
    return `<span class="hpbar"><i style="width:${pct}%"></i></span>`;
  }
  // Enemy/NPC: never exact numbers. Show a coarse band if the server provided one.
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
      const side = c.isPC ? 'pc' : c.category === 'enemy' ? 'enemy' : 'npc';
      const conds =
        c.conditions && c.conditions.length
          ? `<span class="cond">${c.conditions.map(escape).join(', ')}</span>`
          : '';
      return `<div class="${cls.join(' ')}">
        <span class="init">${c.initiative ?? '—'}</span>
        <span class="dot ${side}"></span>
        <span class="name">${escape(c.name)}</span>
        ${conds}
        ${hpCell(c)}
      </div>`;
    })
    .join('');
  elCombat.innerHTML =
    `<div class="sub" style="padding:4px 8px">Round ${combat.round} · turn ${combat.turn + 1}</div>` +
    rows;
}

const feed = [];
function pushEvents(events, initial) {
  if (initial) feed.length = 0;
  for (const e of events) feed.push(e);
  // keep newest 60
  if (feed.length > 60) feed.splice(0, feed.length - 60);
  renderFeed();
}
function renderFeed() {
  if (feed.length === 0) {
    elFeed.innerHTML = '<div class="empty">Waiting for events…</div>';
    return;
  }
  elFeed.innerHTML = feed
    .slice()
    .reverse()
    .map(e => {
      const t = new Date(e.timestampMs).toLocaleTimeString();
      return `<div class="event"><span class="t">${escape(t)}</span>${escape(e.description)}</div>`;
    })
    .join('');
}

function connect() {
  const es = new EventSource(streamUrl);
  const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));

  on('status', renderStatus);
  on('world', renderWorld);
  on('combat', p => renderCombat(p.combat));
  on('events', p => pushEvents(p.events || [], !!p.initial));
  // 'role', 'settings', 'errors', and 'comment.*' are GM-only; the server never
  // sends them to a player connection, so there's nothing to handle here.

  es.onerror = () => {
    elStatus.textContent = 'reconnecting…';
  };
}

connect();
