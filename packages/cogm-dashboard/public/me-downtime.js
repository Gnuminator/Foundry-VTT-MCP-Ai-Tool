// "Downtime" card (I-180) for the player's own page: what my character does between sessions.
// A player sees and changes only their own entries (the server maps the private key to the user).
// All text goes in as textContent, never as markup.

const MAX = 1000;

/** The answer reduced to what the card draws (anything else is dropped). */
export function entriesOf(raw) {
  const list = raw && Array.isArray(raw.entries) ? raw.entries : [];
  return list
    .filter(e => e && typeof e.id === 'string' && typeof e.text === 'string')
    .map(e => ({ id: e.id, text: e.text, updatedAt: String(e.updatedAt || '') }));
}

function el(tag, props = {}, text = '') {
  const node = document.createElement(tag);
  Object.assign(node, props);
  if (text) node.textContent = text;
  return node;
}

export function mountDowntime(root, key) {
  if (!root || !key) return;
  let entries = [];
  let editing = null;
  const headers = { 'X-CoGM-Me': key, 'Content-Type': 'application/json' };

  const status = el('p', { className: 'dt-status', role: 'status' });
  const list = el('ul', { className: 'dt-list' });
  const box = el('textarea', {
    id: 'dt-text',
    maxLength: MAX,
    rows: 3,
    placeholder: 'What does my character do between sessions?',
  });
  box.setAttribute('aria-label', 'Downtime entry');
  const save = el('button', { type: 'button' }, 'Save');
  const cancel = el('button', { type: 'button', hidden: true }, 'Cancel');
  const hint = el(
    'p',
    { className: 'muted' },
    'Only you and your GM see this. It is a wish, not something that has happened.'
  );
  root.append(hint, list, box, save, cancel, status);

  function draw() {
    list.replaceChildren(
      ...entries.map(e => {
        const li = el('li');
        li.append(el('span', { className: 'dt-text' }, e.text));
        const edit = el('button', { type: 'button' }, 'Edit');
        edit.addEventListener('click', () => {
          editing = e.id;
          box.value = e.text;
          cancel.hidden = false;
          box.focus();
        });
        const del = el('button', { type: 'button' }, 'Delete');
        del.addEventListener('click', () => void call('DELETE', `/${e.id}`));
        li.append(' ', edit, ' ', del);
        return li;
      })
    );
  }

  async function call(method, suffix = '', body) {
    status.textContent = '';
    try {
      const res = await fetch(`/api/me/downtime${suffix}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not save. Try again.');
      entries = entriesOf(out);
      draw();
      return true;
    } catch (err) {
      status.textContent = err instanceof TypeError ? 'Could not reach the table.' : err.message;
      return false;
    }
  }

  function reset() {
    editing = null;
    box.value = '';
    cancel.hidden = true;
  }

  save.addEventListener('click', async () => {
    const ok = await call('POST', '', { text: box.value, ...(editing ? { id: editing } : {}) });
    if (ok) reset();
  });
  cancel.addEventListener('click', reset);
  void call('GET');
}
