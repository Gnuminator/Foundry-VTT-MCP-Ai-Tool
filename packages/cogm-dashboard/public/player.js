// Read-only player view (M2). It reads the dedicated player stream
// (/api/player/stream), which carries only the projected player state built on
// the server (player/projection.ts): names as players see them, no enemy HP
// numbers, core conditions only, public rolls only, and handouts whose HTML the
// server already sanitized. A GM credential in this browser changes nothing:
// the player endpoints always project. This page filters nothing itself.

import {
  concentrationReminders,
  myRollRequests,
  portraitFailure,
  portraitProblem,
  rollBannerLines,
  mySheets,
  turnLine,
  turnStatus,
} from './player-me.js';
import {
  handoutTitle,
  sessionPhase,
  splitHandouts,
  visibleHandouts,
  whoLine,
} from './player-session.js';
import { applyTheme, currentMist, loadTheme, setMist } from './theme.js';

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
const elRecap = $('recap');
const elQuests = $('quests');
const elWrap = $('wrap');
const elRollBanner = $('roll-banner');
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
  live: 'Live',
  'foundry-offline': 'Foundry is offline. Wait a moment.',
  disconnected: 'Not connected. Wait a moment.',
  connecting: 'Connecting…',
};

function hpCell(c) {
  if (c.isPC && c.hp) {
    const pct = c.hp.max ? Math.max(0, Math.min(100, (100 * c.hp.value) / c.hp.max)) : 0;
    return `<span class="hpbar"><i style="width:${pct}%"></i></span>`;
  }
  // Enemy/NPC: never numbers. A coarse band if the server provided one.
  if (c.hpBand) return `<span class="hp-muted">${escape(c.hpBand)}</span>`;
  return `<span class="hp-muted">hidden</span>`;
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
        <span class="init">${escape(c.initiative ?? 'not rolled')}</span>
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

// --- Mine: your turn, your character, concentration (player-me.js) -------------------
// Needs the player's own link (/me?k=...), which me.js keeps on this device; without it this
// section stays hidden. The sheets come from /api/me (only the characters this player owns).
const ME_KEY = 'cogm_me_key';
const ME_REFRESH_MS = 8000;
const elMine = $('mine');
const elMineTurn = $('mine-turn');
const elMineAlerts = $('mine-alerts');
const elMineChars = $('mine-chars');
const elMineRolls = $('mine-rolls');
let mySheetList = [];
let portraitOn = true;
let myRolls = [];
const rollNotes = new Map();
let lastCombat = null;
let meLoading = null;
let meAt = 0;
let meMissed = false;
const seenDamage = new Set();
let damagePrimed = false;
const meKey = (() => {
  try {
    return localStorage.getItem(ME_KEY) || '';
  } catch {
    return '';
  }
})();

// One read at a time; a second caller waits for the one in flight instead of skipping it.
function loadMe() {
  if (!meKey) return Promise.resolve();
  if (meLoading) return meLoading;
  meLoading = (async () => {
    try {
      const res = await fetch('/api/me', { headers: { 'X-CoGM-Me': meKey } });
      if (!res.ok) throw new Error(String(res.status));
      const me = await res.json();
      mySheetList = mySheets(me);
      // false only when the GM switched "Player portraits" off; null (unknown) keeps the control.
      portraitOn = me.portraitEnabled !== false;
      myRolls = myRollRequests(me);
      meMissed = false;
    } catch {
      meMissed = true;
    } finally {
      meAt = Date.now();
      meLoading = null;
    }
  })();
  return meLoading;
}

// Open roll requests as buttons: the GM client rolls for your character when you press one.
function renderMineRolls() {
  const ids = new Set(myRolls.map(r => r.buttonId));
  for (const id of [...rollNotes.keys()]) if (!ids.has(id)) rollNotes.delete(id);
  elMineRolls.innerHTML = myRolls
    .map(
      r =>
        `<div class="mine-roll"><button type="button" data-roll="${escape(r.buttonId)}" data-track="player.mine.roll"${rollNotes.get(r.buttonId) === 'Rolling...' ? ' disabled' : ''}>Roll</button> <span>${escape(r.label)}</span> <span class="roll-note">${escape(rollNotes.get(r.buttonId) || '')}</span></div>`
    )
    .join('');
}

// A server-side failure (5xx) can carry a raw error message: players always get the same line.
function rollFailureNote(status, body) {
  if (status >= 500) return 'Could not roll. Ask your GM.';
  return (body && body.error) || 'The roll did not work. Ask your GM.';
}

elMineRolls.addEventListener('click', async e => {
  const btn = e.target instanceof Element ? e.target.closest('button[data-roll]') : null;
  if (!btn || btn.disabled || !meKey) return;
  const id = btn.dataset.roll;
  btn.disabled = true;
  rollNotes.set(id, 'Rolling...');
  btn.parentElement.querySelector('.roll-note').textContent = 'Rolling...';
  try {
    const res = await fetch('/api/me/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CoGM-Me': meKey },
      body: JSON.stringify({ buttonId: id }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      myRolls = myRolls.filter(r => r.buttonId !== id);
    } else {
      rollNotes.set(id, rollFailureNote(res.status, body));
    }
  } catch {
    rollNotes.set(id, 'Could not roll. Ask your GM.');
  }
  await loadMe();
  renderMine();
});

// --- "Upload my portrait": the player's own art on a character they own ----------------
// The picture goes to /api/me/portrait with the private key; the server stores it only in the
// player's own folder and sets the picture of a character they own. Nothing here names a path.
const elPortraitActor = $('portrait-actor');
const elPortraitPick = $('portrait-pick');
const elPortraitToken = $('portrait-token');
const elPortraitFile = $('portrait-file');
const elPortraitNote = $('portrait-note');
const elPortraitBox = $('mine-portrait');
let portraitIds = '';
let portraitBusy = false;

function renderPortraitControl() {
  elPortraitBox.hidden = !portraitOn;
  const ids = mySheetList.map(s => s.id).join(',');
  if (ids === portraitIds) return;
  portraitIds = ids;
  const previous = elPortraitActor.value;
  elPortraitActor.innerHTML = mySheetList
    .map(s => `<option value="${escape(s.id)}">${escape(s.name)}</option>`)
    .join('');
  if (mySheetList.some(s => s.id === previous)) elPortraitActor.value = previous;
  $('portrait-actor-field').hidden = mySheetList.length < 2;
}

elPortraitPick.addEventListener('click', () => {
  if (portraitBusy || !meKey) return;
  elPortraitFile.value = '';
  elPortraitFile.click();
});

elPortraitFile.addEventListener('change', async () => {
  const file = elPortraitFile.files && elPortraitFile.files[0];
  if (!file || portraitBusy || !meKey) return;
  const problem = portraitProblem(file);
  if (problem) {
    elPortraitNote.textContent = problem;
    return;
  }
  const actor = elPortraitActor.value || (mySheetList[0] && mySheetList[0].id) || '';
  const target = elPortraitToken.value === 'portrait' ? 'portrait' : 'both';
  portraitBusy = true;
  elPortraitPick.disabled = true;
  elPortraitNote.textContent = 'Saving...';
  try {
    const res = await fetch(
      `/api/me/portrait?actor=${encodeURIComponent(actor)}&target=${target}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-CoGM-Me': meKey },
        body: file,
      }
    );
    const body = await res.json().catch(() => ({}));
    elPortraitNote.textContent = res.ok
      ? `Done${body.actorName ? `: ${body.actorName} has your new picture` : ''}.`
      : portraitFailure(res.status, body);
  } catch {
    elPortraitNote.textContent = 'Could not save your picture. Ask your GM.';
  } finally {
    portraitBusy = false;
    elPortraitPick.disabled = false;
    elPortraitFile.value = '';
  }
});

// --- Roll requests, pushed live (item roll-status-player-push) -------------------
// The stream carries every open request with the Foundry user it is for; the page shows the ones
// for the name picked under "Who are you?". With the personal link key the Roll button is fetched
// at once (loadMe) instead of at the next 8 second refresh.
let openRolls = [];
function renderRollBanner() {
  const lines = rollBannerLines(openRolls, currentWho && currentWho.userId, Date.now(), !!meKey);
  elRollBanner.hidden = lines === null;
  if (lines === null) return;
  elRollBanner.innerHTML =
    '<strong>' +
    escape(lines.title) +
    '</strong><span class="roll-hint">' +
    escape(lines.hint) +
    '</span>';
}
function onRolls(open) {
  openRolls = Array.isArray(open) ? open : [];
  renderRollBanner();
  if (meKey && currentWho && openRolls.some(r => r.userId === currentWho.userId)) {
    void loadMe().then(renderMine);
  }
}
// A request nobody answered fades from the page by itself.
setInterval(renderRollBanner, 30000);

function renderMine() {
  if (!meKey || mySheetList.length === 0) {
    elMine.hidden = true;
    return;
  }
  elMine.hidden = false;
  renderMineRolls();
  renderPortraitControl();
  const status = turnStatus(
    lastCombat,
    mySheetList.map(s => s.id)
  );
  const line = turnLine(status);
  elMineTurn.hidden = !line;
  elMineTurn.className = 'turn-banner' + (status && line ? ' ' + status.state : '');
  elMineTurn.textContent = line || '';
  elMineChars.innerHTML = mySheetList
    .map(s => {
      const pct = s.hp && s.hp.max ? Math.max(0, Math.min(100, (100 * s.hp.value) / s.hp.max)) : 0;
      const hp = s.hp
        ? `<span class="hpbar"><i style="width:${pct}%"></i></span> ${escape(s.hp.value)}/${escape(s.hp.max)}`
        : '';
      const conds = [
        ...s.conditions.filter(c => !(s.concentration && /^concentrating$/i.test(c))),
        s.concentration ? `Concentrating: ${s.concentration}` : '',
      ]
        .filter(Boolean)
        .map(escape)
        .join(', ');
      return `<div class="mine-char"><strong>${escape(s.name)}</strong> ${hp}${conds ? ` <span class="cond">${conds}</span>` : ''}<a href="/me" data-track="player.mine.sheet">Open sheet</a></div>`;
    })
    .join('');
}

async function onMineState(s) {
  lastCombat = s.combat;
  if (!meKey) return;
  const events = Array.isArray(s.events) ? s.events : [];
  if (!damagePrimed) {
    // The first frame carries the recent feed: those lines are history, not new hits.
    for (const e of events) seenDamage.add(e.id);
    damagePrimed = true;
  }
  const fresh = events.some(e => e.type === 'damage' && !seenDamage.has(e.id));
  if (fresh || Date.now() - meAt > ME_REFRESH_MS || mySheetList.length === 0) await loadMe();
  if (fresh && !meMissed) {
    for (const r of concentrationReminders(events, mySheetList, seenDamage)) {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = 'mine-alert';
      div.textContent = `${r.text} (tap to dismiss ✕)`;
      div.title = 'Dismiss';
      div.setAttribute('aria-label', `${r.text} (tap to dismiss)`);
      div.addEventListener('click', () => div.remove());
      elMineAlerts.prepend(div);
    }
  }
  renderMine();
}

// "Daylight, Rain": the module sends fixed labels only; nothing else is shown.
function sceneLook(env) {
  if (!env) return '';
  const parts = [env.timeOfDay, env.weather].filter(p => typeof p === 'string' && p);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function renderState(s) {
  void onMineState(s);
  elStatus.textContent = STATUS_LABELS[s.status] || STATUS_LABELS.connecting;
  elWorld.textContent = s.world ? s.world.title : 'No world yet';
  elScene.textContent = s.scene ? `· ${s.scene}${sceneLook(s.sceneEnvironment)}` : '';
  elWrap.dataset.phase = sessionPhase(s);
  renderCombat(s.combat);
  renderFeed(s.events);
}

// I-039: a handout revealed to chosen players shows only to them (by the picked name; the
// table is trusted, D-065). Opening one tells the GM's seen log, once per page per visit.
/** Whether the name list had names to pick from: null until asked (a stored pick or Skip never asks), so the hint only hides once we know there is nobody. */
let pickerHasNames = null;

let lastHandouts = [];
let currentWho = null;
const reportedSeen = new Set();

function handoutHtml(h) {
  // `html` was rebuilt server-side from an allowlist (no attributes, no scripts).
  return `<details class="handout" data-handout="${escape(h.id)}"><summary data-track="player.handouts.open">${escape(handoutTitle(h))}${h.isNew ? ' <span class="handout-new">New</span>' : ''}${Array.isArray(h.players) ? ' <span class="handout-private">just for you</span>' : ''}</summary>
        <div class="content">${h.html}</div></details>`;
}

function fill(el, list, emptyText) {
  el.innerHTML = list.length
    ? list.map(handoutHtml).join('')
    : `<div class="empty">${emptyText}</div>`;
}

function renderHandouts(handouts) {
  lastHandouts = Array.isArray(handouts) ? handouts : [];
  const { recap, quests, rest } = splitHandouts(
    visibleHandouts(lastHandouts, currentWho && currentWho.userId)
  );
  fill(elRecap, recap ? [recap] : [], 'No recap yet.');
  fill(
    elHandouts,
    rest,
    currentWho && currentWho.userId
      ? 'Nothing revealed yet.'
      : pickerHasNames !== false
        ? 'Nothing revealed yet. Pick your name to see handouts meant just for you.'
        : 'Nothing revealed yet.'
  );
  fill(elQuests, quests, 'No quests yet.');
}

function reportSeen(handoutId) {
  const me = currentWho && currentWho.userId;
  if (!me || !handoutId || reportedSeen.has(handoutId)) return;
  reportedSeen.add(handoutId);
  fetch('/api/player/handout-seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-CoGM-Token': TOKEN } : {}) },
    body: JSON.stringify({ handoutId, userId: me }),
  }).catch(() => reportedSeen.delete(handoutId));
}

for (const el of [elHandouts, elRecap, elQuests]) {
  el.addEventListener(
    'toggle',
    e => {
      const box = e.target;
      if (box && box.open && box.dataset && box.dataset.handout) reportSeen(box.dataset.handout);
    },
    true
  );
}

function connect() {
  const es = new EventSource(streamUrl);
  const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));
  on('state', renderState);
  on('handouts', p => renderHandouts(p.handouts));
  on('rolls', p => onRolls(p.open));
  on('theme', p => renderTheme(p.theme));
  es.onerror = () => {
    elStatus.textContent = 'Reconnecting. Wait a moment.';
    // The browser retries a dropped connection by itself, but gives up for good on a non-200 answer
    // (a 502 while the dashboard restarts): make a new one after a wait. The server sends the
    // state again on connect, which sets the label.
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      setTimeout(connect, 2000 + Math.random() * 3000);
    }
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
  currentWho = who;
  renderRollBanner();
  renderHandouts(lastHandouts);
  elWhoPicker.hidden = true;
  elWho.hidden = false;
  elWhoName.textContent = whoLine(who);
  elWhoChange.textContent = who && who.name ? 'Not you? Change' : 'Pick your name';
  // No names to pick from: the button would open an empty picker.
  elWhoChange.hidden = !(who && who.name) && pickerHasNames === false;
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
  pickerHasNames = names.length > 0;
  renderHandouts(lastHandouts);
  // Nobody known yet (the bridge has not seen the players): ask again next visit.
  if (names.length === 0) {
    showWho(null);
    return;
  }
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

// The GM's theme for this world (D-085); the mist is this phone's own choice.
const elMistControl = $('mist-control');
const elMist = $('select-mist');
function renderTheme(theme) {
  elMistControl.hidden = applyTheme(theme) !== 'veil';
}
elMist.value = currentMist();
elMist.addEventListener('change', () => setMist(elMist.value));
void loadTheme(TOKEN ? { 'X-CoGM-Token': TOKEN } : {}).then(renderTheme);

connect();
usage.trackView('player.main.view');
