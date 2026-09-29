// "Open in Foundry" confirm page (Obsidian O4, docs/design/OBSIDIAN-O4-DESIGN.md section 6).
// A link in a mirror note lands here: GET /open?uuid=... serves this static page to
// everyone, and nothing happens until the GM clicks Open (the button has focus, so Enter
// works). The click POSTs to /api/open with the GM token of this browser's dashboard
// sign-in (localStorage `cogm_token`, written by the GM page). This page only reads that
// token: it never writes it and never takes a token from the URL. The page shares an
// origin with the token, so every text goes in with textContent, never as HTML.
//
// The pure functions are exported for open-route.test.ts; the DOM part runs only in a
// browser.

/** The same pattern as `FOUNDRY_UUID_SOURCE` in shared/src/export-index.ts (a test pins it). */
export const UUID_SOURCE =
  '^(?:Compendium\\.[\\w-]+\\.[\\w-]+\\.)?[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16}(?:\\.[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16})*$';
export const UUID_MAX_LENGTH = 300;
const UUID = new RegExp(UUID_SOURCE);
const USER_ID = /^[A-Za-z0-9]{16}$/;
const TOKEN_KEY = 'cogm_token';

const LABELS = {
  Actor: 'Actor',
  Item: 'Item',
  Scene: 'Scene',
  JournalEntry: 'Journal',
  JournalEntryPage: 'Journal page',
  RollTable: 'Roll table',
  Macro: 'Macro',
  Playlist: 'Playlist',
  PlaylistSound: 'Sound',
  Cards: 'Card stack',
  Adventure: 'Adventure',
  Note: 'Map note',
  Token: 'Token',
};

export function isUuid(value) {
  return typeof value === 'string' && value.length <= UUID_MAX_LENGTH && UUID.test(value);
}

/** The uuid from a query string, or null when it is missing or not a document uuid. */
export function uuidFromSearch(search) {
  const value = new URLSearchParams(search).get('uuid');
  return isUuid(value) ? value : null;
}

/** "Actor", "Journal page", ... for the document a uuid names (its last type segment). */
export function documentLabel(uuid) {
  const parts = uuid.split('.');
  const type = parts[parts.length - 2] || 'document';
  const label = Object.prototype.hasOwnProperty.call(LABELS, type)
    ? LABELS[type]
    : type.replace(/([a-z])([A-Z])/g, '$1 $2');
  return uuid.startsWith('Compendium.') ? `${label} (compendium)` : label;
}

/** The fetch options for POST /api/open. The token goes in a header, never in the URL. */
export function openRequest(uuid, token, userId) {
  const headers = { 'Content-Type': 'application/json', 'X-CoGM-Request': 'open' };
  if (token) headers['X-CoGM-Token'] = token;
  return {
    method: 'POST',
    headers,
    body: JSON.stringify(userId ? { uuid, userId } : { uuid }),
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  };
}

function validGms(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    gm =>
      gm &&
      typeof gm.id === 'string' &&
      USER_ID.test(gm.id) &&
      typeof gm.name === 'string' &&
      gm.name !== ''
  );
}

/**
 * What to show for an answer from POST /api/open (status 0: no answer at all).
 * Returns { tone: 'ok' | 'info' | 'error', text, canRetry, gms? }. `ctx.label` is the
 * document label; `ctx.gmName` the GM picked from a list, if any.
 */
export function describeAnswer(status, body, ctx) {
  const b = body && typeof body === 'object' ? body : {};
  const code = typeof b.code === 'string' ? b.code : '';
  const serverText = typeof b.error === 'string' ? b.error : '';

  if (status === 200) {
    if (b.opened !== true) {
      return { tone: 'error', text: 'Foundry did not open it.', canRetry: true };
    }
    const what =
      typeof b.name === 'string' && b.name !== ''
        ? `${ctx.label} "${b.name}"`
        : `the ${ctx.label.toLowerCase()}`;
    // A raw user id means nothing to the GM; the name is known only after a GM choice.
    const where = ctx.gmName ? `${ctx.gmName}'s Foundry screen` : "the GM's Foundry screen";
    return { tone: 'ok', text: `Opened ${what} on ${where}.`, canRetry: true };
  }
  if (status === 401) {
    return {
      tone: 'error',
      text:
        'This browser is not signed in to the co-GM dashboard as the GM. Open the dashboard ' +
        'once in this browser with your GM link, then click Open again. The web viewer ' +
        'built into Obsidian keeps its own storage: sign in there as well, or open the link ' +
        'in your normal browser.',
      canRetry: true,
    };
  }
  if (status === 403 && code === 'gm-required') {
    return {
      tone: 'error',
      text: 'This browser is signed in with a player token. Only the GM can open documents in Foundry.',
      canRetry: false,
    };
  }
  if (status === 403) {
    return {
      tone: 'error',
      text: `The dashboard refused the request: ${serverText || 'cross-site request'}`,
      canRetry: false,
    };
  }
  if (status === 409 && code === 'choose-gm') {
    const gms = validGms(b.gms);
    return gms.length > 0
      ? {
          tone: 'info',
          text: 'Several GMs are logged in. Choose whose Foundry screen to use:',
          canRetry: false,
          gms,
        }
      : {
          tone: 'error',
          text: 'Several GMs are logged in, and the dashboard could not list them. Try again in a moment.',
          canRetry: true,
        };
  }
  if (status === 429) {
    return {
      tone: 'error',
      text: 'Too many opens in a short time. Wait a few seconds, then click Open again.',
      canRetry: true,
    };
  }
  if (status === 400) {
    return {
      tone: 'error',
      text:
        code === 'bad-uuid'
          ? 'The dashboard refused this document id.'
          : `The dashboard refused the request: ${serverText || 'bad request'}`,
      canRetry: false,
    };
  }
  if (status === 502) {
    return {
      tone: 'error',
      text: `${serverText || 'Foundry could not open it.'} Is Foundry open with the bridge connected?`,
      canRetry: true,
    };
  }
  if (status === 0) {
    return {
      tone: 'error',
      text: 'The co-GM dashboard did not answer. Is it running?',
      canRetry: true,
    };
  }
  return {
    tone: 'error',
    text: `Unexpected answer from the dashboard (HTTP ${status}).`,
    canRetry: true,
  };
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function main() {
  const question = document.getElementById('question');
  const openButton = document.getElementById('open');
  const gmList = document.getElementById('gms');
  const status = document.getElementById('status');

  const showStatus = (tone, text) => {
    status.className = `status ${tone}`;
    status.textContent = text;
  };

  const uuid = uuidFromSearch(location.search);
  if (!uuid) {
    question.textContent =
      'This link does not name a Foundry document, so there is nothing to open.';
    showStatus('error', 'Check the link in your note.');
    return;
  }

  const label = documentLabel(uuid);
  const code = document.createElement('code');
  code.textContent = uuid;
  question.replaceChildren(
    document.createTextNode(`Open this ${label} (`),
    code,
    document.createTextNode(') on your Foundry screen?')
  );

  let busy = false;
  // The GM picked from a list: "Open again" uses the same screen.
  let chosen = null;
  const setBusy = value => {
    busy = value;
    openButton.disabled = value;
    for (const button of gmList.querySelectorAll('button')) button.disabled = value;
  };

  const showGms = gms => {
    const buttons = gms.map(gm => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = gm.name;
      button.addEventListener('click', () => void submit(gm.id, gm.name));
      return button;
    });
    gmList.replaceChildren(...buttons);
    gmList.hidden = buttons.length === 0;
    if (buttons.length > 0) buttons[0].focus();
  };

  async function submit(userId, gmName) {
    if (busy) return;
    setBusy(true);
    showStatus('info', 'Opening...');
    let answerStatus = 0;
    let body = null;
    try {
      const res = await fetch('/api/open', openRequest(uuid, readToken(), userId));
      answerStatus = res.status;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    } catch {
      answerStatus = 0;
    }
    const answer = describeAnswer(answerStatus, body, { label, gmName });
    if (answer.tone === 'ok') chosen = userId ? { id: userId, name: gmName } : null;
    showStatus(answer.tone, answer.text);
    setBusy(false);
    openButton.hidden = !answer.canRetry;
    showGms(answer.gms || []);
    if (answer.tone === 'ok') openButton.textContent = 'Open again';
    if (!answer.gms && answer.canRetry) openButton.focus();
  }

  openButton.addEventListener('click', () => void submit(chosen?.id, chosen?.name));
  openButton.hidden = false;
  openButton.focus();
}

if (typeof document !== 'undefined') main();
