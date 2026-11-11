#!/usr/bin/env node
// Compare a fresh read of the Cloudflare setup with the expected state (D: cloudflare-guard).
//
//   node scripts/cloudflare-compare.mjs <live.json> <expected.json>
//
// Both files have the same shape (the skill `cloudflare-work` holds the read-only connector code
// that produces live.json). The expected file lives in the vault, not in this public repo:
//   {
//     "apps":   [{ "name", "hostname", "session_duration", "auto_redirect_to_identity", "http_only_cookie_attribute",
//                  "policies": [{ "name", "kind", "count" }] }],
//     "tunnel": { "routes": [{ "hostname", "service" }] },
//     "dns":    [{ "name", "proxied" }]
//   }
// No emails and no ids are in either file: policies carry a kind and a count only.
// Prints every difference, one per line; exit 0 when none, 1 on any difference, 2 on bad usage or input.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_FIELDS = ['hostname', 'session_duration', 'auto_redirect_to_identity', 'http_only_cookie_attribute'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function byKey(list, key, what, out) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const k = item?.[key];
    if (typeof k !== 'string' || !k) {
      out.push(`${what}: an entry has no "${key}"`);
      continue;
    }
    if (map.has(k)) out.push(`${what} ${k}: listed twice`);
    map.set(k, item);
  }
  return map;
}

/** The list of differences between live and expected (empty when they match). */
export function compare(live, expected) {
  const out = [];
  for (const [label, v] of [['live', live], ['expected', expected]]) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return [`${label}: not a JSON object`];
  }
  const diffMaps = (what, key, l, e, fields) => {
    const lm = byKey(l, key, `${what} (live)`, out);
    const em = byKey(e, key, `${what} (expected)`, out);
    for (const [k, ev] of em) {
      const lv = lm.get(k);
      if (!lv) {
        out.push(`${what} ${k}: missing in live`);
        continue;
      }
      for (const f of fields) {
        if (!same(lv[f], ev[f])) out.push(`${what} ${k}: ${f} is ${JSON.stringify(lv[f])}, expected ${JSON.stringify(ev[f])}`);
      }
      if (what === 'app') {
        const lp = byKey(lv.policies, 'name', `app ${k} policies (live)`, out);
        const ep = byKey(ev.policies, 'name', `app ${k} policies (expected)`, out);
        for (const [pn, pv] of ep) {
          const got = lp.get(pn);
          if (!got) out.push(`app ${k}: policy ${pn} missing in live`);
          else {
            if (got.kind !== pv.kind) out.push(`app ${k}: policy ${pn} kind is ${JSON.stringify(got.kind)}, expected ${JSON.stringify(pv.kind)}`);
            if (got.count !== pv.count) out.push(`app ${k}: policy ${pn} count is ${JSON.stringify(got.count)}, expected ${JSON.stringify(pv.count)}`);
          }
        }
        for (const pn of lp.keys()) if (!ep.has(pn)) out.push(`app ${k}: policy ${pn} is in live but not expected`);
      }
    }
    for (const k of lm.keys()) if (!em.has(k)) out.push(`${what} ${k}: in live but not expected`);
  };
  diffMaps('app', 'name', live.apps, expected.apps, APP_FIELDS);
  diffMaps('dns', 'name', live.dns, expected.dns, ['proxied']);
  diffMaps('tunnel route', 'hostname', live.tunnel?.routes, expected.tunnel?.routes, ['service']);
  return out;
}

function load(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`cloudflare-compare: cannot read ${path.basename(file)}: ${e.message}`);
    process.exit(2);
  }
}

function main(argv) {
  if (argv.length !== 2) {
    console.error('usage: node scripts/cloudflare-compare.mjs <live.json> <expected.json>');
    process.exit(2);
  }
  const diffs = compare(load(argv[0]), load(argv[1]));
  if (diffs.length === 0) {
    console.log('cloudflare-compare: no drift');
    return;
  }
  for (const d of diffs) console.log(`DRIFT ${d}`);
  console.log(`cloudflare-compare: ${diffs.length} difference(s)`);
  process.exit(1);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  main(process.argv.slice(2));
}
