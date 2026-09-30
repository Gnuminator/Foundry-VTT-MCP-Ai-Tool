// Usage log client (I-084): which controls of this page get used. Plain script, no
// dependencies, loaded by index.html and player.html before their own script. Plan:
// docs/design/USAGE-LOG.md; contract: shared/src/usage.ts.
//
// Events are meaningful actions only, named by fixed control names. Never typed text, tool
// arguments, setting values, ids or error messages: only the name, the kind and a few numbers
// or codes. The server decides the surface and who, so this only forwards a claim.
//
// The script tag says where to send (data attributes): data-usage-endpoint (the POST route),
// data-usage-surface ('dashboard' or 'player'), data-usage-token-key (the localStorage key the
// page keeps its token under). Public API: window.cogmUsage.
(function () {
  'use strict';

  var script = document.currentScript;
  var ENDPOINT = (script && script.getAttribute('data-usage-endpoint')) || '/api/usage';
  var SURFACE = (script && script.getAttribute('data-usage-surface')) || 'dashboard';
  var TOKEN_KEY = (script && script.getAttribute('data-usage-token-key')) || 'cogm_token';

  var FLUSH_MS = 15000;
  var FLUSH_AT = 50;
  var VIEW_REPORT_MS = 5 * 60 * 1000;
  var MAX_QUEUE = 500;

  var NAME_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+){1,4}$/;
  var CODE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
  var OUTCOMES = ['ok', 'error', 'cancelled'];

  function randomId() {
    var bytes = new Uint8Array(8);
    try {
      crypto.getRandomValues(bytes);
    } catch (e) {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var id = '';
    for (var j = 0; j < bytes.length; j++) id += ('0' + bytes[j].toString(16)).slice(-2);
    return id;
  }

  var clientId = randomId();
  var seq = 0;
  var queue = [];
  var who = { userId: null };

  function getToken() {
    try {
      var fromUrl = new URL(location.href).searchParams.get('token');
      if (fromUrl) return fromUrl;
    } catch (e) {}
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function cleanCode(code) {
    if (code === undefined || code === null) return undefined;
    var c = String(code).toLowerCase();
    return CODE_RE.test(c) ? c : undefined;
  }

  // --- The queue ---------------------------------------------------------------

  function sameEvent(a, b) {
    return (
      a.kind === b.kind &&
      a.name === b.name &&
      a.kind !== 'view' &&
      a.outcome === b.outcome &&
      a.code === b.code
    );
  }

  /** Add one event; an identical one right after it merges into its `count`. */
  function enqueue(kind, name, extra) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return;
    var ev = { kind: kind, name: name };
    var x = extra || {};
    if (kind === 'view' && typeof x.durationMs === 'number')
      ev.durationMs = Math.round(x.durationMs);
    if (kind === 'tool' && OUTCOMES.indexOf(x.outcome) >= 0) ev.outcome = x.outcome;
    if (kind === 'tool' || kind === 'error') {
      var code = cleanCode(x.code);
      if (code) ev.code = code;
    }
    var last = queue[queue.length - 1];
    if (last && sameEvent(last, ev)) {
      last.count = (last.count || 1) + 1;
    } else {
      ev.v = 1;
      ev.seq = seq++;
      ev.key = clientId + ':' + ev.seq;
      ev.t = Date.now();
      ev.clientId = clientId;
      ev.surface = SURFACE;
      ev.who = { role: SURFACE === 'dashboard' ? 'gm' : 'player', userId: null, name: null };
      queue.push(ev);
    }
    if (queue.length >= FLUSH_AT) flush(false);
  }

  function body(events) {
    var payload = { events: events };
    if (who.userId) payload.who = { userId: who.userId };
    return JSON.stringify(payload);
  }

  function requeue(events) {
    queue = events.concat(queue).slice(-MAX_QUEUE);
  }

  /** Send what is queued. `closing` uses sendBeacon (survives the page going away). */
  function flush(closing) {
    if (queue.length === 0) return;
    var events = queue;
    queue = [];
    var json = body(events);
    if (closing && navigator.sendBeacon) {
      var token = getToken();
      var url = ENDPOINT + (token ? '?token=' + encodeURIComponent(token) : '');
      try {
        if (navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return;
      } catch (e) {}
    }
    var headers = { 'Content-Type': 'application/json' };
    var t = getToken();
    if (t) headers['X-CoGM-Token'] = t;
    try {
      fetch(ENDPOINT, { method: 'POST', headers: headers, body: json, keepalive: closing })
        .then(function (res) {
          // A server error or a dropped connection may be temporary; a 4xx will not get better.
          if (res.status >= 500) requeue(events);
        })
        .catch(function () {
          if (!closing) requeue(events);
        });
    } catch (e) {
      requeue(events);
    }
  }

  // --- Views: visible time only ------------------------------------------------

  var views = {}; // name -> { acc, since, reported }

  function visible() {
    return document.visibilityState !== 'hidden';
  }

  function reportView(name, final) {
    var v = views[name];
    if (!v) return;
    var now = Date.now();
    var dur = v.acc + (v.since !== null ? now - v.since : 0);
    v.acc = 0;
    if (v.since !== null) v.since = now;
    if (dur > 0 || (final && !v.reported)) {
      v.reported = true;
      enqueue('view', name, { durationMs: dur });
    }
  }

  function reportAllViews() {
    Object.keys(views).forEach(function (name) {
      reportView(name, false);
    });
  }

  function onVisibility() {
    var now = Date.now();
    if (visible()) {
      Object.keys(views).forEach(function (name) {
        if (views[name].since === null) views[name].since = now;
      });
    } else {
      Object.keys(views).forEach(function (name) {
        var v = views[name];
        if (v.since !== null) {
          v.acc += now - v.since;
          v.since = null;
        }
      });
      reportAllViews();
      flush(true);
    }
  }

  // --- Public API --------------------------------------------------------------

  var api = {};

  /** A meaningful use of a control (kind, fixed control name, optional code or outcome). */
  api.track = function (kind, name, extra) {
    enqueue(kind, name, extra);
  };

  /** A tool run from the tool runner (the tool name comes from the tool list). */
  api.trackTool = function (toolName, outcome, code) {
    var slug = String(toolName || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    enqueue('tool', 'tool.' + slug, { outcome: outcome, code: code });
  };

  /** A view (page, drawer, panel) is open from now until endView; only visible time counts. */
  api.trackView = function (name) {
    if (typeof name !== 'string' || !NAME_RE.test(name) || views[name]) return;
    views[name] = { acc: 0, since: visible() ? Date.now() : null, reported: false };
  };

  /** The view closed: report its visible time. */
  api.endView = function (name) {
    if (!views[name]) return;
    reportView(name, true);
    delete views[name];
  };

  /** A keyboard shortcut was used (only its fixed name, never the typed text). */
  api.trackShortcut = function (name) {
    enqueue('shortcut', name);
  };

  /** The player page: the user the person picked (the server checks it). */
  api.setWho = function (claim) {
    who = { userId: claim && typeof claim.userId === 'string' ? claim.userId : null };
  };

  api.flush = function () {
    flush(false);
  };

  window.cogmUsage = api;

  // --- Automatic tracking ------------------------------------------------------

  var TEXT_INPUT = /^(text|search|number|email|url|password|tel)$/;

  function tracked(target) {
    var el = target && target.closest ? target.closest('[data-track]') : null;
    return el && el.getAttribute('data-track') ? el : null;
  }

  // One delegated listener for every control carrying the tracking attribute. Selects count on
  // change, forms on submit, text fields on focus; everything else on click.
  document.addEventListener('click', function (e) {
    var el = tracked(e.target);
    if (!el) return;
    var tag = el.tagName;
    if (tag === 'SELECT' || tag === 'FORM' || tag === 'TEXTAREA') return;
    if (tag === 'INPUT' && TEXT_INPUT.test(el.type || 'text')) return;
    enqueue('action', el.getAttribute('data-track'));
  });
  document.addEventListener('change', function (e) {
    var el = tracked(e.target);
    if (el && el.tagName === 'SELECT') enqueue('action', el.getAttribute('data-track'));
  });
  document.addEventListener('submit', function (e) {
    var el = tracked(e.target);
    if (el && el.tagName === 'FORM') enqueue('action', el.getAttribute('data-track'));
  });
  document.addEventListener('focusin', function (e) {
    var el = tracked(e.target);
    if (!el) return;
    var isText =
      el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT.test(el.type || 'text'));
    if (isText) enqueue('action', el.getAttribute('data-track'));
  });

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', function () {
    reportAllViews();
    flush(true);
  });

  setInterval(function () {
    flush(false);
  }, FLUSH_MS);
  setInterval(function () {
    if (visible()) {
      reportAllViews();
      flush(false);
    }
  }, VIEW_REPORT_MS);
})();
