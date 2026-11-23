/**
 * Cloudflare Worker: puts The Veil stylesheet on Foundry's /join page (Backlog join-page-veil-edge).
 *
 * Foundry loads no module code or styles on /join, so the look is added at the edge: the Worker
 * passes the request on to Foundry (the tunnel origin) and, for the /join HTML only, appends one
 * <style> block to <head> with HTMLRewriter. Everything else passes through untouched.
 *
 * Fails open: a non-HTML or non-200 answer, any rewrite error, or VEIL_OFF=1 returns Foundry's
 * own response; an exception in the Worker itself passes the request on to the origin. Removing the route or the Worker gives Foundry's normal join page; nothing breaks.
 */
import { VEIL_JOIN_CSS } from './veil-join-css.mjs';

const JOIN_PATH = /^\/join\/?$/;

export const STYLE_TAG = `<style id="ai-tool-veil-join">${VEIL_JOIN_CSS}</style>`;

/** Whether this request is the join page itself: GET /join (or /join/). */
export function isJoinRequest(request) {
  if (request.method !== 'GET') return false;
  return JOIN_PATH.test(new URL(request.url).pathname);
}

/**
 * @param {Request} request
 * @param {{ VEIL_OFF?: string }} [env]
 * @param {{ fetchOrigin?: (r: Request) => Promise<Response>, Rewriter?: new () => any }} [deps]
 */
export async function handle(request, env = {}, deps = {}) {
  const fetchOrigin = deps.fetchOrigin ?? (r => fetch(r));
  const Rewriter = deps.Rewriter ?? globalThis.HTMLRewriter;
  const response = await fetchOrigin(request);
  try {
    if (env.VEIL_OFF === '1' || !isJoinRequest(request) || !Rewriter) return response;
    const type = response.headers.get('content-type') ?? '';
    if (response.status !== 200 || !type.includes('text/html')) return response;
    // The join page is a few KB: rewrite a clone and read it fully before answering, so a
    // rewriter fault shows up here (and falls back to the untouched response), not mid-stream.
    const html = await new Rewriter()
      .on('head', {
        element(element) {
          element.append(STYLE_TAG, { html: true });
        },
      })
      .transform(response.clone())
      .text();
    // The clone was read, the original body was not: release it so the origin connection is not held open.
    await response.body?.cancel?.().catch?.(() => {});
    const headers = new Headers(response.headers);
    // The body changed: drop validators and the old length so a browser never keeps a stale look.
    for (const name of ['etag', 'last-modified', 'content-length']) headers.delete(name);
    return new Response(html, { status: response.status, headers });
  } catch {
    return response;
  }
}

export default {
  fetch(request, env, ctx) {
    // If the Worker itself throws (for example the origin fetch), Cloudflare passes the request
    // on to the origin instead of showing its own error page.
    ctx?.passThroughOnException?.();
    return handle(request, env);
  },
};
