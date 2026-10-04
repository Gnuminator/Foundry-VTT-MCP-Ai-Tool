// My character (I-096): the player's own sheet behind their private link. The key arrives once
// in the address (/me?k=...), is kept on this device and taken out of the address at once, and
// goes to the server in a header only. Read-only; refreshes during play.

import { applyTheme } from './theme.js';
import { esc, signed, renderPaper2014, renderPaper2024 } from './me-paper.js';

const KEY = 'cogm_me_key';
const VIEW = 'cogm_me_view';
const CHAR = 'cogm_me_char';
const REFRESH_MS = 8000;
const VIEWS = ['fancy', 'paper2024', 'paper2014'];

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

function renderFancy(s) {
  const hp = s.hp;
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
  main.innerHTML =
    view === 'paper2024'
      ? renderPaper2024(s)
      : view === 'paper2014'
        ? renderPaper2014(s)
        : renderFancy(s);
}

async function load() {
  if (!key) {
    $('me-main').innerHTML = '<p class="me-empty">Open the link your GM sent you.</p>';
    return;
  }
  try {
    const res = await fetch('/api/me', { headers: { 'X-CoGM-Me': key } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    data = body;
    applyTheme(body.theme);
    render();
    $('me-updated').textContent =
      `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    if (!data)
      $('me-main').innerHTML = `<p class="me-empty">${esc(String(err.message || err))}</p>`;
    $('me-updated').textContent = 'Not updated: the table may be offline.';
  }
}

document.addEventListener('click', e => {
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
$('me-print').addEventListener('click', () => window.print());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void load();
});
setInterval(() => {
  if (!document.hidden) void load();
}, REFRESH_MS);
render();
void load();
