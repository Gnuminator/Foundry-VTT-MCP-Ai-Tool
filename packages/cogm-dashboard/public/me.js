// My character (I-096): the player's own sheet behind their private link. The key arrives once
// in the address (/me?k=...), is kept on this device and taken out of the address at once, and
// goes to the server in a header only. Read-only; refreshes during play.

import { applyTheme } from './theme.js';
import { esc, signed, renderPaper2014, renderPaper2024, renderPaperNight } from './me-paper.js';
import { turnOptions } from './player-me.js';
import { mountDowntime } from './me-downtime.js';

const KEY = 'cogm_me_key';
const TURN_CARD = 'cogm_me_turn_card'; // "off" hides the turn card on this device
const VIEW = 'cogm_me_view';
const CHAR = 'cogm_me_char';
const REFRESH_MS = 8000;
const VIEWS = ['fancy', 'paper2024', 'paper2014', 'night'];

const $ = id => document.getElementById(id);
const store = {
  get: k => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Private windows may refuse storage; the choice then lasts for this page only.
    }
  },
};

const params = new URLSearchParams(location.search);
if (params.has('k')) {
  store.set(KEY, params.get('k') || '');
  history.replaceState(null, '', '/me');
}
const key = store.get(KEY) || '';

let view = VIEWS.includes(store.get(VIEW)) ? store.get(VIEW) : 'fancy';
let data = null;
let charId = store.get(CHAR);

function pct(value, max) {
  return max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
}

function pips(value, max) {
  return '●'.repeat(Math.max(0, value)) + '○'.repeat(Math.max(0, max - value));
}

function rows(items) {
  return items.length
    ? `<ul class="rows">${items.map(([k, v]) => `<li><span>${esc(k)}</span><span class="val">${esc(v)}</span></li>`).join('')}</ul>`
    : '<p class="muted">None.</p>';
}

function classLine(s) {
  const classes = s.classes
    .map(c => `${c.name}${c.subclass ? ` (${c.subclass})` : ''} ${c.levels}`)
    .join(', ');
  return [s.species, classes || `Level ${s.level}`].filter(Boolean).join(' · ');
}

function turnCardHtml(s) {
  const groups = turnOptions(s);
  return `<section class="card wide turn-card" id="me-turn-card">
      <h2>On my turn</h2>
      ${groups
        .map(
          g =>
            `<h3>${esc(g.label)}</h3><ul>${g.options
              .map(o => `<li><b>${esc(o.name)}</b><span>${esc(o.note)}</span></li>`)
              .join('')}</ul>`
        )
        .join('')}
    </section>`;
}

function renderFancy(s) {
  const hp = s.hp;
  const showTurnCard = store.get(TURN_CARD) !== 'off';
  const conditions = [
    ...s.conditions.map(c => `<span class="chip warn">${esc(c)}</span>`),
    s.concentration ? `<span class="chip">Concentrating: ${esc(s.concentration)}</span>` : '',
    s.exhaustion > 0 ? `<span class="chip warn">Exhaustion ${s.exhaustion}</span>` : '',
    s.inspiration ? '<span class="chip">Heroic inspiration</span>' : '',
  ].join('');
  const down = hp.value <= 0;
  const slots = s.slots.map(sl => [
    sl.pact ? `Pact (level ${sl.level})` : `Level ${sl.level}`,
    `${pips(sl.value, sl.max)}  ${sl.value}/${sl.max}`,
  ]);
  // Features with uses, and items whose uses come back (a wand's charges), not rations or arrows.
  const resources = [...s.features, ...s.inventory.filter(i => i.uses?.recovery)]
    .filter(f => f.uses)
    .map(f => [
      f.name,
      `${f.uses.value}/${f.uses.max}${f.uses.recovery ? ` · ${f.uses.recovery}` : ''}`,
    ]);
  const attacks = s.inventory
    .filter(i => i.attack || i.damage)
    .map(i => [i.name, [i.attack, i.damage].filter(Boolean).join(' · ')]);
  const caster = s.spells.length > 0 || s.slots.length > 0;
  const prepared = s.spells.filter(sp => sp.prepared);
  const spellsByLevel = new Map();
  for (const sp of prepared) {
    const k = sp.level === 0 ? 'Cantrips' : `Level ${sp.level}`;
    spellsByLevel.set(k, [...(spellsByLevel.get(k) || []), sp.name]);
  }
  const coins = Object.entries(s.currency)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');
  const privateRolls = (data?.privateRolls || []).length
    ? `<section class="card wide" id="me-private-rolls">
      <h2>Your private rolls</h2>
      <ul class="rows">${data.privateRolls
        .map(
          r =>
            `<li><span>${r.kind === 'request' ? 'Asked' : 'Rolled'}: ${esc(r.text)}</span><span class="val muted">${esc(new Date(r.timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span></li>`
        )
        .join('')}</ul>
      <p class="muted">Only you and your GM see these.</p>
    </section>`
    : '';
  return `<div class="fancy">
    <section class="card wide">
      <div class="vitals">
        <div><div class="big">${hp.value}${hp.temp ? `<small>+${hp.temp}</small>` : ''}</div><div class="label">HP of ${hp.max}</div></div>
        <div><div class="big">${s.ac ?? '-'}</div><div class="label">AC</div></div>
        <div><div class="big">${s.initiative === null ? '-' : signed(s.initiative)}</div><div class="label">Initiative</div></div>
      </div>
      <div class="hpbar"><span style="width:${pct(hp.value, hp.max)}%"></span></div>
      <div class="chips">${conditions}</div>
      ${down ? `<p>Death saves: ${pips(s.deathSaves.success, 3)} saved, ${pips(s.deathSaves.failure, 3)} failed</p>` : ''}
    </section>
    ${showTurnCard ? turnCardHtml(s) : ''}
    ${privateRolls}
    ${
      caster
        ? `<section class="card">
      <h2>Spell slots</h2>${rows(slots)}
      ${s.spellcasting.dc !== null ? `<p class="muted">Save DC ${s.spellcasting.dc}${s.spellcasting.attack !== null ? ` · attack ${signed(s.spellcasting.attack)}` : ''}</p>` : ''}
    </section>`
        : ''
    }
    <section class="card">
      <h2>Resources</h2>${rows([...resources, ['Hit dice', `${s.hitDice.value}/${s.hitDice.max}`]])}
    </section>
    <section class="card wide">
      <h2>Abilities</h2>
      <div class="abil">${s.abilities.map(a => `<div><span class="label">${esc(a.label)}</span><b>${signed(a.mod)}</b><span class="muted">${a.score} · save ${signed(a.save)}${a.saveProficient ? '*' : ''}</span></div>`).join('')}</div>
    </section>
    <section class="card"><h2>Attacks</h2>${rows(attacks)}</section>
    ${
      caster
        ? `<section class="card">
      <h2>Prepared spells</h2>
      ${spellsByLevel.size ? [...spellsByLevel].map(([k, names]) => `<p><span class="muted">${esc(k)}:</span> ${esc(names.join(', '))}</p>`).join('') : '<p class="muted">None.</p>'}
    </section>`
        : ''
    }
    <section class="card">
      <h2>Skills</h2>${rows(s.skills.map(k => [`${k.label}${k.proficiency >= 1 ? ' *' : ''}`, signed(k.total)]))}
      <p class="muted">Passive Perception ${s.passivePerception ?? '-'}</p>
    </section>
    <section class="card">
      <h2>Inventory</h2>${rows(s.inventory.map(i => [`${i.name}${i.equipped ? ' (equipped)' : ''}${i.attuned ? ' (attuned)' : ''}`, `×${i.quantity}`]))}
      ${coins ? `<p class="muted">Coins: ${esc(coins)}</p>` : ''}
    </section>
    <label class="me-prefs no-print"><input type="checkbox" id="me-pref-turn"${showTurnCard ? ' checked' : ''} /> Show the "On my turn" card</label>
  </div>`;
}

function render() {
  const main = $('me-main');
  document.body.classList.toggle('paper', view !== 'fancy');
  for (const b of document.querySelectorAll('[data-view]')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  }
  if (!data) return;
  const sheets = data.sheets || [];
  if (!sheets.length) {
    main.innerHTML =
      '<p class="me-empty">Your Foundry user owns no character yet. Ask your GM.</p>';
    return;
  }
  const s = sheets.find(x => x.id === charId) || sheets[0];
  charId = s.id;
  const chars = $('me-chars');
  chars.hidden = sheets.length < 2;
  chars.innerHTML = sheets
    .map(
      x =>
        `<button type="button" data-char="${esc(x.id)}" aria-pressed="${x.id === s.id}">${esc(x.name)}</button>`
    )
    .join('');
  $('me-name').textContent = s.name;
  $('me-sub').textContent = classLine(s);
  document.title = `${s.name}: my character`;
  // A rebuild (the 8 s refresh, a toggle) must not drop keyboard focus from the card switch.
  const hadFocus = document.activeElement?.id === 'me-pref-turn';
  main.innerHTML =
    view === 'paper2024'
      ? renderPaper2024(s)
      : view === 'paper2014'
        ? renderPaper2014(s)
        : view === 'night'
          ? renderPaperNight(
              s,
              new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
            )
          : renderFancy(s);
  if (hadFocus) $('me-pref-turn')?.focus({ preventScroll: true });
}

/** The outdated-helper notice (Danish, then English): server text goes in as textContent only. */
function showClientUpdate(update) {
  const box = $('me-update');
  const ok = update && typeof update.da === 'string' && typeof update.en === 'string';
  box.hidden = !ok;
  $('me-update-da').textContent = ok ? update.da : '';
  $('me-update-en').textContent = ok ? update.en : '';
}

async function load() {
  if (!key) {
    $('me-main').innerHTML = '<p class="me-empty">Open the link your GM sent you.</p>';
    return;
  }
  try {
    const res = await fetch('/api/me', { headers: { 'X-CoGM-Me': key } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load your sheet. Ask your GM.');
    data = body;
    applyTheme(body.theme);
    showClientUpdate(body.clientUpdate);
    render();
    $('me-updated').textContent =
      `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    if (!data) {
      const text =
        err instanceof TypeError ? 'Could not load your sheet. Ask your GM.' : err.message;
      $('me-main').innerHTML = `<p class="me-empty">${esc(String(text))}</p>`;
    }
    $('me-updated').textContent = 'Not updated: the table may be offline.';
  }
}

let connectorLoaded = false;
let connectorLoading = false;

function setConnectorError(text) {
  const box = $('mc-error');
  $('mc-error-text').textContent = text;
  box.hidden = !text;
  $('mc-fields').hidden = !!text;
}

/** An earlier failure may have shown the error card: a later "not set up" answer takes it away. */
function hideConnector() {
  setConnectorError('');
  $('me-connector').hidden = true;
}

/** "Your Claude connector" (D-136): the player's own pair, read once; hidden when not set up. */
async function loadConnector() {
  if (!key || connectorLoaded || connectorLoading) return;
  connectorLoading = true;
  try {
    const res = await fetch('/api/me/connector', { headers: { 'X-CoGM-Me': key } });
    const body = await res.json().catch(() => ({}));
    if (res.ok && !body.enabled) {
      connectorLoaded = true; // not set up for this player: the card stays hidden
      hideConnector();
      return;
    }
    // A 4xx (no world yet, a bad link) is not a broken connector: the card stays hidden. Only a
    // server error or a lost connection gets the error state with a retry.
    if (res.status >= 400 && res.status < 500) {
      hideConnector();
      return;
    }
    if (!res.ok) throw new Error('bad status');
    $('mc-endpoint').value = body.endpoint || '';
    $('mc-id').value = body.clientId || '';
    $('mc-secret').value = body.clientSecret || '';
    $('mc-hint').hidden = !!body.endpoint;
    $('mc-download-row').hidden = !body.endpoint;
    // The remote connector (a web address and your own email) comes first; the extension below is
    // for a player who has a pair and prefers or needs it.
    $('mc-remote-url').value = body.remoteUrl || '';
    $('mc-remote').hidden = !body.remoteUrl;
    setConnectorError('');
    $('mc-fields').hidden = !body.clientId; // after the reset above: no pair, no extension block
    connectorLoaded = true;
    $('me-connector').hidden = false;
  } catch {
    // The card is shown with a retry, so a player is not left with nothing to try.
    setConnectorError('Could not load your connector values. Check your connection and try again.');
    $('me-connector').hidden = false;
    $('me-connector').open = true; // an alert inside a closed details is not announced
  } finally {
    connectorLoading = false;
  }
}

/**
 * "Download my helper": the key is sent as a header (never in the address), so the page fetches the
 * file and saves the bytes itself. The file holds the player's login and is never kept here.
 */
async function downloadHelper() {
  const button = $('mc-download');
  const live = $('mc-live');
  if (!key || button.disabled) return;
  button.disabled = true;
  live.textContent = '';
  try {
    const res = await fetch('/api/me/helper.mcpb', { headers: { 'X-CoGM-Me': key } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      live.textContent = body.error || 'Could not make your helper file. Ask your GM.';
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'foundry-player.mcpb';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    live.textContent = 'Downloaded. Open the file, then restart Claude Desktop.';
  } catch {
    live.textContent = 'Could not download. Check your connection and try again.';
  } finally {
    button.disabled = false;
  }
}

/** Copy `input`'s value; plain http has no clipboard API, so fall back to a selected copy command. */
async function copyValue(input) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(input.value);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  const wasType = input.type;
  if (wasType === 'password') input.type = 'text'; // a hidden field cannot be selected for copy
  input.focus();
  input.select();
  let ok;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  if (wasType === 'password') input.type = 'password';
  return ok;
}

let copiedTimer = null;
function announce(text) {
  const live = $('mc-live');
  live.textContent = text;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (live.textContent = ''), 1500);
}

document.addEventListener('click', e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const input = $(copy.dataset.copy);
    void copyValue(input).then(ok => {
      copy.textContent = ok ? 'Copied' : 'Copy';
      announce(
        ok
          ? 'Copied'
          : input.type === 'password'
            ? 'Could not copy. Press Show, then select the value and copy it.'
            : 'Could not copy. The value is selected: press Ctrl+C.'
      );
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    });
  }
  if (e.target.closest('#mc-retry')) void loadConnector();
  if (e.target.closest('#mc-download')) void downloadHelper();
  if (e.target.closest('#mc-show')) {
    const secret = $('mc-secret');
    const show = secret.type === 'password';
    secret.type = show ? 'text' : 'password';
    $('mc-show').textContent = show ? 'Hide' : 'Show';
    $('mc-show').setAttribute('aria-pressed', String(show));
  }
  const v = e.target.closest('[data-view]');
  if (v) {
    view = v.dataset.view;
    store.set(VIEW, view);
    render();
  }
  const c = e.target.closest('[data-char]');
  if (c) {
    charId = c.dataset.char;
    store.set(CHAR, charId);
    render();
  }
});
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'me-pref-turn') {
    store.set(TURN_CARD, e.target.checked ? 'on' : 'off');
    render();
  }
});
// "My diary" (I-183): the player's own entries, kept on the table's server behind their key.
let diaryEntries = [];
let diaryEditing = null; // the id of the entry in the form, or null for a new one
let diaryLoaded = false;

function diaryStatus(text) {
  $('md-status').textContent = text || '';
}

function diaryCharName() {
  const sheets = (data && data.sheets) || [];
  const s = sheets.find(x => x.id === charId) || sheets[0];
  return s && s.name ? String(s.name) : '';
}

function renderDiary() {
  $('md-list').innerHTML = diaryEntries
    .map(
      e => `<li data-id="${esc(e.id)}">
        <div class="md-meta">${esc(e.character || 'My character')}, ${esc(new Date(e.updatedAt).toLocaleDateString())}</div>
        <p class="md-text">${esc(e.text)}</p>
        <button type="button" data-diary-edit="${esc(e.id)}">Edit</button>
        <button type="button" data-diary-del="${esc(e.id)}">Delete</button>
      </li>`
    )
    .join('');
}

async function diaryCall(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'X-CoGM-Me': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(out.error || 'Could not reach your diary. Try again.');
    err.status = res.status;
    throw err;
  }
  return out;
}

async function loadDiary() {
  if (!key || diaryLoaded) return;
  try {
    const out = await diaryCall('GET', '/api/me/diary');
    diaryEntries = out.entries || [];
    diaryLoaded = true;
    $('me-diary').hidden = false;
    $('md-memory').hidden = out.persistent !== false;
    diaryStatus('');
    renderDiary();
  } catch (err) {
    // No diary here (an older server, or no link): the section stays hidden. Any other failure
    // shows it with the reason; opening it again retries.
    const status = err && err.status;
    if (status === 501 || status === 401 || status === 404) return;
    $('me-diary').hidden = false;
    diaryStatus(status ? err.message : 'Could not reach your diary. Open it again to retry.');
  }
}

function diaryReset() {
  diaryEditing = null;
  $('md-text').value = '';
  $('md-cancel').hidden = true;
  $('md-save').textContent = 'Save entry';
}

$('md-form').addEventListener('submit', async e => {
  e.preventDefault();
  diaryStatus('Saving…');
  try {
    await diaryCall('POST', '/api/me/diary', {
      ...(diaryEditing ? { id: diaryEditing } : {}),
      character: $('md-char').value || diaryCharName(),
      text: $('md-text').value,
    });
    diaryReset();
    diaryLoaded = false;
    await loadDiary();
    diaryStatus('Saved.');
  } catch (err) {
    diaryStatus(err.message);
  }
});
$('md-cancel').addEventListener('click', () => {
  diaryReset();
  diaryStatus('');
});
$('md-list').addEventListener('click', async e => {
  const edit = e.target.closest('[data-diary-edit]');
  if (edit) {
    const entry = diaryEntries.find(x => x.id === edit.dataset.diaryEdit);
    if (!entry) return;
    diaryEditing = entry.id;
    $('md-char').value = entry.character;
    $('md-text').value = entry.text;
    $('md-cancel').hidden = false;
    $('md-save').textContent = 'Update entry';
    $('md-text').focus();
    return;
  }
  const del = e.target.closest('[data-diary-del]');
  if (del && window.confirm('Delete this diary entry?')) {
    try {
      await diaryCall('DELETE', `/api/me/diary/${encodeURIComponent(del.dataset.diaryDel)}`);
      if (diaryEditing === del.dataset.diaryDel) diaryReset();
      diaryLoaded = false;
      await loadDiary();
      diaryStatus('Deleted.');
    } catch (err) {
      diaryStatus(err.message);
    }
  }
});

$('me-print').addEventListener('click', () => window.print());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void load();
    void loadConnector();
  }
});
setInterval(() => {
  if (!document.hidden) void load();
}, REFRESH_MS);
render();
void load();
void loadConnector();
void loadDiary();
$('me-diary').addEventListener('toggle', () => {
  if ($('me-diary').open && !diaryLoaded) void loadDiary();
});
mountDowntime($('me-downtime'), key);
