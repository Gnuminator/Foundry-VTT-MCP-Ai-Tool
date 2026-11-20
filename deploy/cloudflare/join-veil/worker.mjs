/**
 * Cloudflare Worker: puts The Veil stylesheet on Foundry's /join page (Backlog join-page-veil-edge).
 *
 * Foundry loads no module code or styles on /join, so the look is added at the edge: the Worker
 * passes the request on to Foundry (the tunnel origin) and, for the /join HTML only, appends one
 * <style> block to <head> with HTMLRewriter. Everything else passes through untouched.
 *
 * Fails open: a non-HTML or non-200 answer, any error, or VEIL_OFF=1 returns Foundry's own
 * response. Removing the route or the Worker gives Foundry's normal join page; nothing breaks.
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
    return new Rewriter()
      .on('head', {
        element(element) {
          element.append(STYLE_TAG, { html: true });
        },
      })
      .transform(response);
  } catch {
    return response;
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
