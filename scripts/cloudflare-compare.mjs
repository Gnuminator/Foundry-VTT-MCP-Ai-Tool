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
//     "tunnel": { "names": ["..."], "routes": [{ "hostname", "path", "service", "access_required", "aud_count" }] },
//     "dns":    [{ "name", "type", "proxied" }],
//     "transform_rules": [{ "phase", "description", "enabled", "action", "expression", "parameters" }],
//     "worker_routes":   [{ "pattern", "script" }],
//     "service_tokens":  [{ "name", "expires_at" }]   // YYYY-MM-DD; a WARN line under 60 days, never drift
//   }
// No emails and no ids are in either file: policies carry a kind and a count only.
// Prints every difference, one per line; exit 0 when none, 1 on any difference, 2 on bad usage or input.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_FIELDS = [
  'hostname',
  'session_duration',
  'auto_redirect_to_identity',
  'http_only_cookie_attribute',
];
const ROUTE_FIELDS = ['path', 'service', 'access_required', 'aud_count'];
const DNS_FIELDS = ['proxied'];
const RULE_FIELDS = ['enabled', 'action', 'expression', 'parameters'];
const WORKER_FIELDS = ['script'];
const TOKEN_FIELDS = ['expires_at'];

/** Every field the read code in the cloudflare-work skill produces, per section, that this script compares.
 *  A test fails when the read code has a field that is not listed here (read but not compared). */
export const COMPARED = {
  apps: ['name', ...APP_FIELDS, 'policies'],
  routes: ['hostname', ...ROUTE_FIELDS],
  dns: ['name', 'type', ...DNS_FIELDS],
  transform_rules: ['phase', 'description', ...RULE_FIELDS],
  worker_routes: ['pattern', ...WORKER_FIELDS],
  service_tokens: ['name', ...TOKEN_FIELDS],
};

/** Service tokens that run out within this many days get a warning. */
export const TOKEN_WARN_DAYS = 60;

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
  for (const [label, v] of [
    ['live', live],
    ['expected', expected],
  ]) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return [`${label}: not a JSON object`];
  }
  if (!Array.isArray(expected.apps) || expected.apps.length === 0)
    return ['expected: no apps listed (a wrong or empty file)'];
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
        if (!same(lv[f], ev[f]))
          out.push(
            `${what} ${k}: ${f} is ${JSON.stringify(lv[f])}, expected ${JSON.stringify(ev[f])}`
          );
      }
      if (what === 'app') {
        const lp = byKey(lv.policies, 'name', `app ${k} policies (live)`, out);
        const ep = byKey(ev.policies, 'name', `app ${k} policies (expected)`, out);
        for (const [pn, pv] of ep) {
          const got = lp.get(pn);
          if (!got) out.push(`app ${k}: policy ${pn} missing in live`);
          else {
            if (got.kind !== pv.kind)
              out.push(
                `app ${k}: policy ${pn} kind is ${JSON.stringify(got.kind)}, expected ${JSON.stringify(pv.kind)}`
              );
            if (got.count !== pv.count)
              out.push(
                `app ${k}: policy ${pn} count is ${JSON.stringify(got.count)}, expected ${JSON.stringify(pv.count)}`
              );
          }
        }
        for (const pn of lp.keys())
          if (!ep.has(pn)) out.push(`app ${k}: policy ${pn} is in live but not expected`);
      }
    }
    for (const k of lm.keys()) if (!em.has(k)) out.push(`${what} ${k}: in live but not expected`);
  };
  diffMaps('app', 'name', live.apps, expected.apps, APP_FIELDS);
  // A name can have several records (A, MX, TXT), so DNS is keyed on name and type.
  const keyed = list =>
    Array.isArray(list) ? list.map(x => ({ ...x, key: `${x?.name} ${x?.type}` })) : list;
  diffMaps('dns', 'key', keyed(live.dns), keyed(expected.dns), DNS_FIELDS);
  // One hostname can carry several routes that differ by path.
  const route = list =>
    Array.isArray(list) ? list.map(x => ({ ...x, key: `${x?.hostname}${x?.path ?? ''}` })) : list;
  diffMaps(
    'tunnel route',
    'key',
    route(live.tunnel?.routes),
    route(expected.tunnel?.routes),
    ROUTE_FIELDS
  );
  const names = l => (Array.isArray(l) ? l.map(name => ({ name })) : l);
  diffMaps('tunnel', 'name', names(live.tunnel?.names), names(expected.tunnel?.names), []);
  const rule = list =>
    Array.isArray(list) ? list.map(x => ({ ...x, key: `${x?.phase} ${x?.description}` })) : list;
  diffMaps(
    'transform rule',
    'key',
    rule(live.transform_rules),
    rule(expected.transform_rules),
    RULE_FIELDS
  );
  diffMaps('worker route', 'pattern', live.worker_routes, expected.worker_routes, WORKER_FIELDS);
  diffMaps('service token', 'name', live.service_tokens, expected.service_tokens, TOKEN_FIELDS);
  return out;
}

/** Warnings (not drift): live service tokens that expire within TOKEN_WARN_DAYS, or already have. */
export function tokenWarnings(live, now = new Date()) {
  const out = [];
  for (const t of Array.isArray(live?.service_tokens) ? live.service_tokens : []) {
    const at = Date.parse(t?.expires_at);
    if (Number.isNaN(at)) {
      out.push(`service token ${t?.name}: no readable expiry date`);
      continue;
    }
    const days = Math.floor((at - now.getTime()) / 86400000);
    if (days < TOKEN_WARN_DAYS)
      out.push(
        `service token ${t.name}: ${days < 0 ? 'expired' : `expires in ${days} days`} (${t.expires_at})`
      );
  }
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
  const live = load(argv[0]);
  const diffs = compare(live, load(argv[1]));
  for (const w of tokenWarnings(live)) console.log(`WARN ${w}`);
  if (diffs.length === 0) {
    console.log('cloudflare-compare: no drift');
    return;
  }
  for (const d of diffs) console.log(`DRIFT ${d}`);
  console.log(`cloudflare-compare: ${diffs.length} difference(s)`);
  process.exit(1);
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main(process.argv.slice(2));
}
