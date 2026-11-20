# Join page Veil Worker

A Cloudflare Worker that adds The Veil look to Foundry's `/join` page. Foundry loads no module
styles there, so the look is added at the edge with `HTMLRewriter`: one `<style>` block appended to
`<head>`. Only `GET /join` is changed; every other request passes straight through.

## Safe by design

- Fails open: a non-HTML or non-200 answer, any rewrite error (the small page is rewritten fully
  before it is sent), or the `VEIL_OFF=1` variable returns Foundry's own response. An exception in
  the Worker itself passes the request on to Foundry (`passThroughOnException`).
- With the Worker route removed, Foundry's normal join page is served. Nothing depends on it.
- Colours, borders and type only; no layout is touched.

## Files

- `worker.mjs`: the Worker.
- `veil-join-css.mjs`: the stylesheet (colours from the dashboard's Veil theme).
- `worker.test.mjs`: `node --test deploy/cloudflare/join-veil/worker.test.mjs`.
- `wrangler.toml.template`: placeholders only; the real hostname stays out of the repo.

## Try it locally

`npx wrangler dev --local` with a small wrapper that calls `handle(request, env, { fetchOrigin })`
and fetches the test server on `127.0.0.1:30001`; open the Worker's `/join` and look for
`<style id="ai-tool-veil-join">`.

## Deploying

Deploying the Worker and adding its route is a Cloudflare change: propose it first, get the OK,
and follow `.claude/skills/cloudflare-work`. Not done yet.
