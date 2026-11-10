// Light or dark for the live strip in a Foundry window (item live-screen-b-foundry): the module
// follows Foundry's own colour setting and tells the strip, first in the address (?scheme=light),
// then by a message whenever the setting changes. Only the page that frames this one is heard, and
// the message carries one word. Without either, the strip keeps the dashboard's dark look.

import { frameParentOrigin } from './mapPick';

/** The `type` the Foundry module posts (packages/foundry-module/src/live-window.ts). */
export const LIVE_SCHEME_MESSAGE = 'fmb-live-scheme';

export type Scheme = 'light' | 'dark';

function asScheme(value: unknown): Scheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** The scheme a message asks for, or null when it is something else. */
export function parseSchemeMessage(data: unknown): Scheme | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, scheme } = data as { type?: unknown; scheme?: unknown };
  return type === LIVE_SCHEME_MESSAGE ? asScheme(scheme) : null;
}

/** Show a scheme on the page; the light tokens are in public/themes/light.css. */
export function applyScheme(scheme: Scheme, root: HTMLElement = document.documentElement): void {
  root.dataset.scheme = scheme;
}

/** Apply the scheme in the address and follow the frame parent's messages. Returns the cleanup. */
export function followFrameScheme(target: Window = window): () => void {
  const root = target.document.documentElement;
  const fromAddress = asScheme(new URLSearchParams(target.location.search).get('scheme'));
  if (fromAddress !== null) applyScheme(fromAddress, root);
  const parentOrigin = target.parent !== target ? frameParentOrigin(target) : null;
  const onMessage = (event: MessageEvent): void => {
    if (event.source === null || target.parent === target || event.source !== target.parent) return;
    // The same rule as the map pick: when the browser names the parent's origin, it must match.
    if (parentOrigin !== null && event.origin !== parentOrigin) return;
    const scheme = parseSchemeMessage(event.data);
    if (scheme !== null) applyScheme(scheme, root);
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}
