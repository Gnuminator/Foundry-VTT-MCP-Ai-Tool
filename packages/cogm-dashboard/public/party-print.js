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
let unreadable = [];

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
  $('party-sub').textContent =
    `${shown.length} of ${sheets.length} sheets, two pages each` +
    (unreadable.length ? `; could not read ${unreadable.join(', ')}` : '');
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
    unreadable = body.unreadable || [];
    render();
    return true;
  } catch (err) {
    const message = String(err.message || err);
    if (sheets.length) {
      // A refresh that failed keeps the sheets already shown; only the note changes.
      $('party-sub').textContent = `Could not refresh: ${message}`;
    } else {
      $('party-main').innerHTML = `<p class="me-empty">${esc(message)}</p>`;
      $('party-sub').textContent = '';
    }
    return false;
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
// Fresh values and print time: read again just before the print dialog opens.
$('party-print').addEventListener('click', () => {
  // Not when the read failed: the page would print an error, or sheets that may be out of date.
  void load().then(ok => {
    if (ok) window.print();
  });
});
void load();
