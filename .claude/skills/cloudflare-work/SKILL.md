---
name: cloudflare-work
description: How to read and change the Cloudflare setup (Access applications, tunnel routes, DNS) through the Cloudflare connector for the Foundry AI Tool, with the user's approval enforced by the app. Use before any call to the connector's execute tool, when the user asks for a Cloudflare change, or when checking for drift.
---

# Cloudflare work

The connector's `execute` tool runs `cloudflare.request({ method, path, ... })`. The hook
`.claude/hooks/guard-cloudflare.mjs` lets code with only literal `method: 'GET'` calls run and makes
the app ask the user for everything else. The prompt is the user's approval. If no prompt appears
for a write, tell the user; never edit `.claude/settings.local.json`.

## Rules

- **Reads are free.** Write the method as the literal `'GET'` inline in each call.
- **Propose a change first**, in chat: what, why, the exact call and what could go wrong. Then make
  the call; approve only what was shown.
- **Access applications take only PUT (the whole object).** Read the app, change one field, send it
  back with `policies` as `[{ id, precedence }]`, read it again and compare every other field. A
  dropped policy fails closed, so check the policy list first.
- **After each change** add one line to vault `Dev/Foundry AI Tool/Cloudflare changes.md` (date,
  app, field, before, after, who approved), update `Cloudflare expected state.json` there, and run
  the drift check.
- **Never print tokens, emails or account ids.** Reduce reads to names, settings and counts.
  Nothing about the domain goes into the public repo.
- The connector has no token access (403); do not try.

## Drift check

1. Run the read-only code below through `execute` (no trailing `;`: the connector rejects it, so the
   block is fenced as `text` to keep prettier from adding one); save the result outside the repo.
2. `node scripts/cloudflare-compare.mjs <live.json> "<vault>/Dev/Foundry AI Tool/Cloudflare expected state.json"`
   prints every difference and exits 1 on any.

```text
async () => {
  const get = async (path, query) =>
    (await cloudflare.request({ method: 'GET', path, query })).result;
  const rules = p => [...(p.include ?? []), ...(p.require ?? [])];
  const kindOf = p =>
    p.decision +
    ':' +
    ([...new Set(rules(p).map(r => Object.keys(r)[0]))].sort().join('+') || 'none');
  const apps = (await get(`/accounts/${accountId}/access/apps`, { per_page: 100 })).map(a => ({
    name: a.name,
    hostname: a.domain,
    session_duration: a.session_duration,
    auto_redirect_to_identity: !!a.auto_redirect_to_identity,
    http_only_cookie_attribute: !!a.http_only_cookie_attribute,
    policies: (a.policies ?? []).map(p => ({
      name: p.name,
      kind: kindOf(p),
      count: rules(p).length,
    })),
  }));
  const routes = [];
  for (const t of await get(`/accounts/${accountId}/cfd_tunnel`, {
    is_deleted: false,
    per_page: 50,
  })) {
    const cfg = await get(`/accounts/${accountId}/cfd_tunnel/${t.id}/configurations`);
    for (const r of cfg?.config?.ingress ?? [])
      if (r.hostname) routes.push({ hostname: r.hostname, service: r.service });
  }
  const dns = [];
  for (const z of await get('/zones', { per_page: 50 }))
    for (const r of await get(`/zones/${z.id}/dns_records`, { per_page: 200 }))
      dns.push({ name: r.name, proxied: !!r.proxied });
  return JSON.stringify({ apps, tunnel: { routes }, dns });
}
```
