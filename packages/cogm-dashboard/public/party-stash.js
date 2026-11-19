// "Party stash" card (I-175) for the player page: what the party carries, by holder, a search by
// item name and the group's gold. The server (party-stash.ts) already hides unidentified and
// secret items behind the words "Unidentified item"; this file only draws and filters.

const REFRESH_MS = 30000;

const escape = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** The answer of /api/me/stash reduced to what the card draws (anything else is dropped). */
export function stashOf(raw) {
  const holders = raw && Array.isArray(raw.holders) ? raw.holders : [];
  return {
    holders: holders
      .filter(h => h && typeof h.name === 'string')
      .map(h => ({
        name: h.name,
        items: (Array.isArray(h.items) ? h.items : [])
          .filter(i => i && typeof i.name === 'string')
          .map(i => ({
            name: i.name,
            quantity: typeof i.quantity === 'number' ? i.quantity : 1,
            unidentified: i.unidentified === true,
          })),
      })),
    totalGold: raw && typeof raw.totalGold === 'number' ? raw.totalGold : 0,
  };
}

/** Holders with only the items whose name has the search words in it; a holder with none is left out. */
export function filterStash(stash, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return stash.holders;
  return stash.holders
    .map(h => ({ ...h, items: h.items.filter(i => i.name.toLowerCase().includes(q)) }))
    .filter(h => h.items.length > 0);
}

export function goldLine(totalGold) {
  const text = Number.isInteger(totalGold) ? String(totalGold) : totalGold.toFixed(2);
  return `${text} gp`;
}

function holdersHtml(holders) {
  if (holders.length === 0) return '<p class="stash-empty">Nothing matches.</p>';
  return holders
    .map(
      h =>
        `<div class="stash-holder"><h4>${escape(h.name)}</h4>` +
        (h.items.length === 0
          ? '<p class="stash-empty">Carries nothing yet.</p>'
          : '<ul>' +
            h.items
              .map(
                i =>
                  `<li${i.unidentified ? ' class="stash-hidden"' : ''}>${escape(i.name)}${i.quantity > 1 ? ` <span class="stash-qty">x${i.quantity}</span>` : ''}</li>`
              )
              .join('') +
            '</ul>') +
        '</div>'
    )
    .join('');
}

/**
 * Add the card after `anchor` (the "mine" card) and keep it fresh. `key` is the player's own
 * link key; without one nothing is drawn (the card is for players with a link).
 */
export function mountPartyStash(anchor, key) {
  if (!anchor || !key) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'party-stash.css';
  document.head.appendChild(link);

  const card = document.createElement('section');
  card.className = 'card party-stash';
  card.hidden = true;
  card.style.gridColumn = '1 / -1';
  card.innerHTML =
    '<h2>Party stash</h2><div class="body">' +
    '<p class="stash-gold">The group\'s gold: <strong id="stash-gold">...</strong></p>' +
    '<input type="search" id="stash-search" placeholder="Search by item name" aria-label="Search the stash by item name" />' +
    '<div id="stash-list" aria-live="polite"></div></div>';
  anchor.after(card);

  const elGold = card.querySelector('#stash-gold');
  const elList = card.querySelector('#stash-list');
  const elSearch = card.querySelector('#stash-search');
  let stash = null;
  let lastHtml = '';

  function draw() {
    if (!stash) return;
    elGold.textContent = goldLine(stash.totalGold);
    const html =
      stash.holders.length === 0
        ? '<p class="stash-empty">Nobody carries anything yet.</p>'
        : holdersHtml(filterStash(stash, elSearch.value));
    // Only touch the list when it changed: the live region must not re-announce each refresh.
    if (html !== lastHtml) {
      lastHtml = html;
      elList.innerHTML = html;
    }
  }
  async function load() {
    try {
      const res = await fetch('/api/me/stash', { headers: { 'X-CoGM-Me': key } });
      if (!res.ok) throw new Error(String(res.status));
      stash = stashOf(await res.json());
      card.hidden = false;
      draw();
    } catch {
      // Keep what was shown; with nothing shown yet, say so instead of leaving the card hidden.
      if (!stash) {
        card.hidden = false;
        elGold.textContent = '...';
        elList.innerHTML = '<p class="stash-empty">Could not load the stash right now.</p>';
      }
    }
  }
  elSearch.addEventListener('input', draw);
  void load();
  setInterval(() => {
    if (!document.hidden) void load();
  }, REFRESH_MS);
}
