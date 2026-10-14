// Whether a box has more to show than fits: a scrolling list is a tab stop only then (axe's
// scrollable-region-focusable asks for a keyboard way to scroll it, and a tab stop on a list that
// does not scroll is noise).
import { useEffect, useState, type RefCallback } from 'react';

/**
 * A ref for the scrolling element and whether it scrolls now. It re-measures when the element is
 * resized and whenever `content` changes (new rows grow the content, not the box).
 */
export function useScrolls(content: unknown): [RefCallback<HTMLElement>, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    if (!el) return;
    const measure = (): void =>
      setScrolls(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [el, content]);
  return [setEl, scrolls];
}
