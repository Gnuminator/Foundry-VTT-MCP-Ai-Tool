// Tablet remote (item tablet-remote): a long press on a touch screen shows what a mouse would show
// on hover, the element's `title`. Used by the live screen only.
import { useEffect } from 'react';

/** How long a finger must stay down, in milliseconds. */
const LONG_PRESS_MS = 550;
/** How far the finger may drift (px) before it counts as a scroll, not a press. */
const LONG_PRESS_SLOP = 10;

/** The part of an element this needs (a DOM Element fits; tests pass plain objects). */
export interface TitleNode {
  getAttribute(name: string): string | null;
  parentElement: TitleNode | null;
}

/** The nearest title at or below the root's children, walking up; null when there is none. */
export function titleAt(el: TitleNode | null, root: TitleNode): string | null {
  for (let cur = el; cur && cur !== root; cur = cur.parentElement) {
    const t = cur.getAttribute('title');
    if (t && t.trim() !== '') return t.trim();
  }
  return null;
}

/**
 * While mounted, a finger or pen held on an element with a title (inside `rootId`) for
 * LONG_PRESS_MS calls `show(title)` and swallows the click that follows the release. A mouse
 * keeps the browser's own hover tooltip.
 */
export function useLongPressDetail(rootId: string, show: (text: string) => void): void {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return undefined;
    let timer: number | undefined;
    let start: { x: number; y: number } | null = null;
    let fired = false;
    const cancel = (): void => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      start = null;
    };
    const down = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      cancel();
      fired = false;
      const text = titleAt(e.target as Element | null, root);
      if (text === null) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        fired = true;
        timer = undefined;
        show(text);
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent): void => {
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) cancel();
    };
    const click = (e: MouseEvent): void => {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const menu = (e: Event): void => {
      if (fired) e.preventDefault();
    };
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', cancel);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('click', click, true);
    root.addEventListener('contextmenu', menu);
    return (): void => {
      cancel();
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', cancel);
      root.removeEventListener('pointercancel', cancel);
      root.removeEventListener('click', click, true);
      root.removeEventListener('contextmenu', menu);
    };
  }, [rootId, show]);
}
