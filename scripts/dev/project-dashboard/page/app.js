// Project dashboard page. Plain script, no libraries. All data goes into the DOM through
// textContent / setAttribute, never innerHTML.
'use strict';

const REPO_URL = 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool';
const POLL_MS = 15000;
const TICK_MS = 30000;

let snap = null;
let fetching = false;
let lastError = null;

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, String(v));
  // CSP blocks style attributes; the CSSOM (node.style.x) is allowed.
  if (opts.style) for (const [k, v] of Object.entries(opts.style)) node.style[k] = v;
  for (const c of children) if (c) node.append(c);
  return node;
}

function replace(id, ...nodes) {
  document.getElementById(id).replaceChildren(...nodes);
}

function fmtTokens(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

function fmtM(n) {
  return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
}

function minutesBetween(fromMs, toMs) {
  return Math.floor((toMs - fromMs) / 60000);
}

function ago(iso, now) {
  if (!iso) return '';
  const m = Math.max(0, minutesBetween(Date.parse(iso), now));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} days ago`;
}

function until(iso, now) {
  const m = Math.ceil((Date.parse(iso) - now) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m <= 0) return 'now';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function th(text, cls) {
  return el('th', { text, cls });
}

function link(href, text) {
  return el('a', { text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
}

function prLink(n) {
  return link(`${REPO_URL}/pull/${n}`, `#${n}`);
}

function badge(text, cls = '') {
  return el('span', { cls: `badge ${cls}`.trim(), text });
}

// ---- lanes ----

function cacheCell(row, now) {
  const td = el('td', { cls: 'nowrap' });
  if (row.state !== 'waiting' || !row.cacheColdAt) return td;
  const left = Math.ceil((Date.parse(row.cacheColdAt) - now) / 60000);
  if (!Number.isFinite(left)) return td;
  if (left <= 0) {
    td.textContent = 'cold';
    td.className = 'nowrap amber';
  } else {
    td.textContent = `cold in ${left} min`;
    if (left <= 5) td.className = 'nowrap amber';
  }
  return td;
}

function laneRow(row, now) {
  const tr = el('tr');
  tr.append(
    el('td', {}, [
      el('span', { cls: `dot ${row.state}`, attrs: { title: row.state, 'aria-label': row.state } }),
    ])
  );
  tr.append(
    el('td', {
      cls: 'title',
      text: row.title || row.sessionId,
      attrs: { title: row.title || row.sessionId },
    })
  );
  tr.append(el('td', { cls: 'nowrap', text: ago(row.lastActivity, now) }));
  const lvl = row.level === 'amber' || row.level === 'red' ? row.level : '';
  tr.append(el('td', { cls: `num ${lvl}`.trim(), text: fmtTokens(row.context) }));
  tr.append(el('td', { cls: 'num muted', text: fmtTokens(row.peak) }));
  tr.append(cacheCell(row, now));
  tr.append(el('td', {}, [row.doNotReuse ? badge('do not reuse', 'red') : null]));
  const where = [row.branch, row.worktree].filter(Boolean).join(' / ');
  tr.append(el('td', { cls: 'where small muted mono', text: where, attrs: { title: where } }));
  tr.append(el('td', { cls: 'nowrap' }, [row.pr != null ? prLink(row.pr) : null]));
  return tr;
}

function laneTable(rows, now) {
  const head = el('tr', {}, [
    th(''),
    th('Title'),
    th('Last activity'),
    th('Context', 'num'),
    th('Peak', 'num'),
    th('Cache'),
    th(''),
    th('Branch / worktree'),
    th('PR'),
  ]);
  const body = el('tbody');
  for (const r of rows) body.append(laneRow(r, now));
  return el('div', { cls: 'tablewrap' }, [el('table', {}, [el('thead', {}, [head]), body])]);
}

function renderLanes(now) {
  const lanes = snap.lanes || { rows: [], cap: { used: 0, max: 3 } };
  const open = lanes.rows.filter(r => !r.closed);
  const closed = lanes.rows.filter(r => r.closed);
  const cap = lanes.cap || { used: 0, max: 3 };
  const over = cap.used > cap.max;
  const head = el('div', { cls: 'panel-head' }, [
    el('h2', { text: 'Lanes', attrs: { id: 'lanes-h' } }),
    el('span', {
      cls: over ? 'cap over' : 'cap',
      text: `Lanes ${cap.used} / ${cap.max} (+ steward)`,
    }),
  ]);
  const parts = [head];
  parts.push(
    open.length ? laneTable(open, now) : el('p', { cls: 'muted', text: 'No open sessions.' })
  );
  if (closed.length) {
    const d = el('details', { cls: 'closed' }, [
      el('summary', { text: `Closed sessions (${closed.length})` }),
      laneTable(closed, now),
    ]);
    parts.push(d);
  }
  replace('lanes', ...parts);
}

// ---- plan ----

function renderPlan(now) {
  const plan = snap.plan || { windows: [] };
  const parts = [el('h2', { text: 'Plan', attrs: { id: 'plan-h' } })];
  if (!plan.windows || !plan.windows.length) {
    parts.push(
      el('p', {
        cls: 'muted',
        text: 'No plan numbers yet: the plan meter plugin writes them after the next turn of any session.',
      })
    );
  } else {
    for (const w of plan.windows) {
      const pct = Math.max(0, Math.min(100, Number(w.percentUsed) || 0));
      const level = pct >= 95 ? 'red' : pct >= 80 ? 'amber' : '';
      const resets = w.resetsAt ? `resets in ${until(w.resetsAt, now)}` : '';
      parts.push(
        el('div', { cls: 'gauge' }, [
          el('div', { cls: 'gauge-top' }, [
            el('span', { text: w.label || w.kind }),
            el('span', { cls: 'num', text: `${Math.round(pct)}%` }),
          ]),
          el(
            'div',
            {
              cls: `bar ${level}`.trim(),
              attrs: {
                role: 'progressbar',
                'aria-valuenow': Math.round(pct),
                'aria-valuemin': 0,
                'aria-valuemax': 100,
              },
            },
            [el('span', { style: { width: `${pct}%` } })]
          ),
          el('div', { cls: 'small muted', text: resets }),
        ])
      );
    }
    if (plan.asOf)
      parts.push(
        el('div', {
          cls: 'small muted',
          text: `as of ${clock(plan.asOf)} (${plan.source === 'get_usage' ? 'get_usage' : 'plugin'})`,
        })
      );
  }
  replace('plan', ...parts);
}

// ---- lock ----

function renderLock(now) {
  const lock = snap.lock || { state: 'no-script', queue: [] };
  const parts = [el('h2', { text: 'Test server lock', attrs: { id: 'lock-h' } })];
  if (lock.state === 'no-script') {
    parts.push(el('p', { cls: 'muted', text: 'No lock script yet' }));
  } else if (lock.state === 'unreadable') {
    parts.push(el('p', { cls: 'lock-state held', text: 'lock.json cannot be read' }));
    parts.push(
      el('p', {
        cls: 'small muted',
        text: 'Nobody can tell who holds the test server. Check with the lanes, then lock.ps1 take -Force starts a fresh lock.',
      })
    );
  } else if (lock.state === 'free') {
    parts.push(el('p', { cls: 'lock-state free', text: 'Free' }));
  } else {
    parts.push(
      el('p', { cls: 'lock-state held', text: 'Held ' }, [
        lock.old ? badge('old: maybe crashed (take -Force)', 'amber') : null,
      ])
    );
    const dl = el('dl', { cls: 'kv' });
    dl.append(
      el('dt', { text: 'Holder' }),
      el('dd', { text: lock.holder || lock.session || 'unknown' })
    );
    if (lock.since)
      dl.append(el('dt', { text: 'Since' }), el('dd', { text: ago(lock.since, now) }));
    if (lock.purpose) dl.append(el('dt', { text: 'Purpose' }), el('dd', { text: lock.purpose }));
    parts.push(dl);
  }
  if (lock.queue && lock.queue.length) {
    parts.push(el('div', { cls: 'small muted', text: 'Queue' }));
    const ol = el('ol', { cls: 'queue' });
    for (const q of lock.queue) {
      const bits = [
        q.holder || q.session || 'unknown',
        q.purpose,
        q.since ? ago(q.since, now) : '',
      ].filter(Boolean);
      ol.append(
        el('li', {}, [
          document.createTextNode(bits.join(' - ')),
          q.old ? badge('old: maybe crashed', 'amber') : null,
        ])
      );
    }
    parts.push(ol);
  }
  replace('lock', ...parts);
}

// ---- pull requests ----

function renderPrs(now) {
  const prs = snap.prs || { items: [], mainRuns: [], error: null };
  const parts = [el('h2', { text: 'Pull requests and CI', attrs: { id: 'prs-h' } })];
  if (prs.error)
    parts.push(el('p', { cls: 'warn-note small', text: `GitHub data unavailable: ${prs.error}` }));
  const items = prs.items || [];
  if (!items.length && !prs.error)
    parts.push(el('p', { cls: 'muted', text: 'No open pull requests.' }));
  const ul = el('ul', { cls: 'plain' });
  for (const p of items) {
    const meta = el('div', { cls: 'pr-meta' });
    meta.append(
      badge(p.state || 'open', p.state === 'MERGED' || p.state === 'merged' ? 'green' : '')
    );
    if (p.draft) meta.append(badge('draft', 'grey'));
    const c = p.checks || { pass: 0, fail: 0, pending: 0, failing: [] };
    if (c.fail) meta.append(badge(`${c.fail} failing`, 'red'));
    if (c.pending) meta.append(badge(`${c.pending} pending`, 'amber'));
    if (c.pass) meta.append(badge(`${c.pass} passing`, 'green'));
    const li = el('li', {}, [
      el('div', { cls: 'pr-title' }, [
        link(p.url || `${REPO_URL}/pull/${p.number}`, `#${p.number}`),
        el('span', { text: ` ${p.title}` }),
      ]),
      meta,
    ]);
    if (c.failing && c.failing.length)
      li.append(el('div', { cls: 'small red-text', text: c.failing.join(', ') }));
    ul.append(li);
  }
  if (items.length) parts.push(ul);
  const runs = prs.mainRuns || [];
  if (runs.length) {
    parts.push(el('div', { cls: 'small muted', text: 'CI on main' }));
    const chips = el('div', { cls: 'chips' });
    for (const r of runs) {
      const st = r.status === 'completed' ? r.conclusion || 'pending' : 'pending';
      const tip = `${r.workflow || ''} ${r.title || ''} (${st})`.trim();
      chips.append(el('span', { cls: `chip ${st}`, attrs: { title: tip, 'aria-label': tip } }));
    }
    parts.push(chips);
  }
  if (prs.asOf) parts.push(el('div', { cls: 'small muted', text: `as of ${clock(prs.asOf)}` }));
  replace('prs', ...parts);
}

// ---- tokens ----

function sumTokens(t) {
  return t ? (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : 0;
}

function renderTokens() {
  const days = (snap.usage && snap.usage.days) || [];
  const parts = [el('h2', { text: "This week's tokens", attrs: { id: 'tokens-h' } })];
  if (!days.length) {
    parts.push(el('p', { cls: 'muted', text: 'No usage recorded this week.' }));
  } else {
    const totals = days.map(d => ({
      date: d.date,
      main: sumTokens(d.main),
      sub: sumTokens(d.sub),
    }));
    const max = Math.max(1, ...totals.map(t => t.main + t.sub));
    for (const t of totals) {
      const bars = el(
        'div',
        { cls: 'tok-bars', attrs: { title: `main ${fmtM(t.main)}, subagents ${fmtM(t.sub)}` } },
        [
          el('span', { cls: 'main', style: { width: `${(t.main / max) * 100}%` } }),
          el('span', { cls: 'sub', style: { width: `${(t.sub / max) * 100}%` } }),
        ]
      );
      parts.push(
        el('div', { cls: 'tok-row' }, [
          el('span', { cls: 'muted small', text: t.date.slice(5) }),
          bars,
          el('span', { cls: 'num', text: fmtM(t.main + t.sub) }),
        ])
      );
    }
    const legend = el('div', { cls: 'legend small muted' });
    const mk = (color, text) =>
      el('span', {}, [el('i', { style: { background: color } }), document.createTextNode(text)]);
    legend.append(mk('var(--blue)', 'main'), mk('var(--amber)', 'subagents'));
    parts.push(legend);
  }
  replace('tokens', ...parts);
}

// ---- frame ----

function renderWarnings() {
  const box = document.getElementById('warnings');
  const list = (snap && snap.warnings) || [];
  box.replaceChildren(...list.map(w => el('div', { cls: 'warning', text: w })));
  box.hidden = list.length === 0;
}

function render() {
  const now = Date.now();
  if (snap) {
    renderWarnings();
    renderLanes(now);
    renderPlan(now);
    renderLock(now);
    renderPrs(now);
    renderTokens();
    replace(
      'footer',
      el('span', { text: `Generated ${snap.generatedAt}. Updates every 15 s while open.` })
    );
  }
  const status = document.getElementById('status');
  status.textContent = lastError
    ? `Could not refresh: ${lastError}`
    : snap
      ? `Updated ${clock(snap.generatedAt)}`
      : 'Loading...';
  status.className = lastError ? 'status bad' : 'status';
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    const res = await fetch('/snapshot.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snap = await res.json();
    lastError = null;
  } catch (err) {
    lastError = String(err && err.message ? err.message : err);
  } finally {
    fetching = false;
    render();
  }
}

setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
}, POLL_MS);
setInterval(render, TICK_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
refresh();
