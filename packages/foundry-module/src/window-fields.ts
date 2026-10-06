/**
 * What the AI Tool windows that have inputs (Handouts, Tarokka) share: they keep
 * the GM's ticks and typed text in the controller, not in the page, so a redraw
 * (a refresh, the change-log signal) does not wipe a choice the GM is still making.
 *
 * - {@link bindFields} listens once per content element and hands every change of an
 *   input that carries `data-field` (and optionally `data-position`) to the controller.
 * - {@link replaceKeepingFocus} swaps the content's HTML and puts the scroll position,
 *   the focused input and its caret back.
 *
 * Both use structural types so they run in Foundry's browser and in the plain-object
 * fakes of the tests.
 */

/** What changed: the input's `data-field`, its `data-position` (or undefined) and its value. */
export type FieldSetter = (
  field: string,
  position: string | undefined,
  value: string | boolean
) => void;

interface FieldTarget {
  dataset?: Record<string, string | undefined>;
  type?: string;
  checked?: boolean;
  value?: string;
}

/** The parts of the content element these helpers touch. */
export interface ContentLike {
  innerHTML: string;
  scrollTop: number;
  addEventListener?(type: string, listener: (event: Event) => void): void;
  querySelector?(selector: string): unknown;
  contains?(node: never): boolean;
  ownerDocument?: { activeElement?: unknown } | null;
}

const bound = new WeakSet<object>();

/** Forward every `input` and `change` of a `data-field` input inside `content` to `set` (once per element). */
export function bindFields(content: ContentLike, set: FieldSetter): void {
  if (bound.has(content) || typeof content.addEventListener !== 'function') return;
  bound.add(content);
  const handler = (event: Event): void => {
    const target = event.target as FieldTarget | null;
    const field = target?.dataset?.field;
    if (!target || !field) return;
    const value = target.type === 'checkbox' ? target.checked === true : (target.value ?? '');
    set(field, target.dataset?.position, value);
  };
  content.addEventListener('input', handler);
  content.addEventListener('change', handler);
}

interface Focusable {
  dataset?: Record<string, string | undefined>;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  focus?: () => void;
  setSelectionRange?: (start: number, end: number) => void;
}

/** The selector of the input a `data-field` / `data-position` pair names. */
function fieldSelector(field: string, position: string | undefined): string {
  const pos = position === undefined ? '' : `[data-position="${position.replace(/"/g, '')}"]`;
  return `[data-field="${field.replace(/"/g, '')}"]${pos}`;
}

/** Replace the content's HTML, keeping the scroll position and the focused field with its caret. */
export function replaceKeepingFocus(content: ContentLike, html: string): void {
  const scrollTop = content.scrollTop;
  let focus: { field: string; position: string | undefined; start: number; end: number } | null =
    null;
  const active = content.ownerDocument?.activeElement as Focusable | null | undefined;
  const field = active?.dataset?.field;
  if (active && field && content.contains?.(active as never) === true) {
    focus = {
      field,
      position: active.dataset?.position,
      start: active.selectionStart ?? 0,
      end: active.selectionEnd ?? 0,
    };
  }
  content.innerHTML = html;
  content.scrollTop = scrollTop;
  if (focus) {
    const next = content.querySelector?.(fieldSelector(focus.field, focus.position)) as
      | Focusable
      | null
      | undefined;
    next?.focus?.();
    try {
      next?.setSelectionRange?.(focus.start, focus.end);
    } catch {
      // A checkbox has no caret.
    }
  }
}
