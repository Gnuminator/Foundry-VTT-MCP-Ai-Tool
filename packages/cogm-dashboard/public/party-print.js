// Party sheets for a paper night (paper-print): the GM prints every player character's paper-night
// sheet in one go. GM only: the sheets come from /api/party-sheets, which needs the GM token (the
// dashboard keeps it under the same key; it is read here and never sent anywhere else). A
// character can be left out with its button before printing.

import { esc, renderPaperNight } from './me-paper.js';

const TOKEN_KEY = 'cogm_token';

const $ = id => document.getElementById(id);

function readToken() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('token');
  try {
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl);
      history.replaceState(null, '', location.pathname);
      return fromUrl;
    }
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return fromUrl || '';
  }
}

const token = readToken();
const left = new Set();
let sheets = [];

function render() {
  const printedAt = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('party-chars').hidden = sheets.length < 2;
  $('party-chars').innerHTML = sheets
    .map(
      s =>
        `<button type="button" data-char="${esc(s.id)}" aria-pressed="${!left.has(s.id)}">${esc(s.name)}</button>`
    )
    .join('');
  const shown = sheets.filter(s => !left.has(s.id));
  $('party-sub').textContent = `${shown.length} of ${sheets.length} sheets, two pages each`;
  $('party-main').innerHTML = shown.length
    ? `<div class="party">${shown.map(s => renderPaperNight(s, printedAt)).join('')}</div>`
    : '<p class="me-empty">No sheets to print.</p>';
}

async function load() {
  try {
    const res = await fetch('/api/party-sheets', {
      headers: token ? { 'X-CoGM-Token': token } : {},
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? 'This page is for the GM. Open it from the dashboard.'
          : body.error || `HTTP ${res.status}`
      );
    }
    sheets = body.sheets || [];
    const unread = body.unreadable || [];
    render();
    if (unread.length) {
      $('party-sub').textContent += `; could not read ${unread.join(', ')}`;
    }
  } catch (err) {
    $('party-main').innerHTML = `<p class="me-empty">${esc(String(err.message || err))}</p>`;
    $('party-sub').textContent = '';
  }
}

document.addEventListener('click', e => {
  const c = e.target.closest('[data-char]');
  if (!c) return;
  const id = c.dataset.char;
  if (left.has(id)) left.delete(id);
  else left.add(id);
  render();
});
$('party-print').addEventListener('click', () => window.print());
void load();
