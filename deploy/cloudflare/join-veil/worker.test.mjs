// Tests for the join page Worker (worker.mjs). The edge's HTMLRewriter does not exist in Node,
// so a small stand-in appends to <head> the same way; the real one is checked with `wrangler dev`.
//   node --test deploy/cloudflare/join-veil/worker.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { handle, isJoinRequest, STYLE_TAG } from './worker.mjs';

// The shape of Foundry 14's /join answer (head, then a body the client fills in).
const JOIN_HTML = `<!DOCTYPE html>
<html>
<head>
    <title>World</title>
    <link href="css/foundry2.css" rel="stylesheet" type="text/css" media="all">
</head>
<body class="auth join flexcol background theme-dark join-theme-default">
    <template id="join-game"></template>
</body>
</html>`;

class FakeRewriter {
  #handler;
  on(selector, handler) {
    assert.equal(selector, 'head');
    this.#handler = handler;
    return this;
  }
  transform(response) {
    const handler = this.#handler;
    const body = new ReadableStream({
      async start(controller) {
        const text = await response.text();
        let appended = '';
        handler.element({
          append(content, options) {
            assert.equal(options.html, true);
            appended += content;
          },
        });
        controller.enqueue(new TextEncoder().encode(text.replace('</head>', `${appended}</head>`)));
        controller.close();
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  }
}

const html = (body = JOIN_HTML, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const run = (url, response, env = {}, init = {}) =>
  handle(new Request(url, init), env, {
    fetchOrigin: async () => response,
    Rewriter: FakeRewriter,
  });

describe('join page Worker', () => {
  test('adds the Veil style block at the end of head on /join', async () => {
    const out = await (await run('https://foundry.example/join', html())).text();
    assert.ok(out.includes(STYLE_TAG));
    assert.ok(out.indexOf(STYLE_TAG) < out.indexOf('</head>'));
    assert.ok(out.indexOf('foundry2.css') < out.indexOf(STYLE_TAG), 'after Foundry CSS');
    assert.ok(out.includes('<template id="join-game">'), 'the rest of the page is kept');
    assert.equal(out.split('ai-tool-veil-join').length, 2, 'added once');
  });

  test('also /join/ and with a query', async () => {
    for (const url of ['https://f.example/join/', 'https://f.example/join?x=1']) {
      const out = await (await run(url, html())).text();
      assert.ok(out.includes(STYLE_TAG), url);
    }
  });

  test('other paths and methods pass through untouched', async () => {
    for (const url of [
      'https://f.example/game',
      'https://f.example/join-x',
      'https://f.example/',
    ]) {
      assert.equal(await (await run(url, html())).text(), JOIN_HTML, url);
    }
    const post = await run('https://f.example/join', html(), {}, { method: 'POST' });
    assert.equal(await post.text(), JOIN_HTML);
  });

  test('VEIL_OFF=1 is the kill switch', async () => {
    const out = await (await run('https://f.example/join', html(), { VEIL_OFF: '1' })).text();
    assert.equal(out, JOIN_HTML);
  });

  test('non-HTML and non-200 answers pass through', async () => {
    const json = new Response('{}', { headers: { 'content-type': 'application/json' } });
    assert.equal(await (await run('https://f.example/join', json)).text(), '{}');
    const redirect = await run('https://f.example/join', html('', 302));
    assert.equal(redirect.status, 302);
    assert.equal(await redirect.text(), '');
  });

  test("a failing rewriter returns Foundry's own response", async () => {
    class Broken {
      on() {
        throw new Error('boom');
      }
    }
    const response = html();
    const out = await handle(
      new Request('https://f.example/join'),
      {},
      {
        fetchOrigin: async () => response,
        Rewriter: Broken,
      }
    );
    assert.equal(await out.text(), JOIN_HTML);
  });

  test('without HTMLRewriter the page passes through', async () => {
    const out = await handle(
      new Request('https://f.example/join'),
      {},
      {
        fetchOrigin: async () => html(),
        Rewriter: null,
      }
    );
    assert.equal(await out.text(), JOIN_HTML);
  });

  test('isJoinRequest', () => {
    assert.equal(isJoinRequest(new Request('https://f.example/join')), true);
    assert.equal(isJoinRequest(new Request('https://f.example/joined')), false);
  });
});
