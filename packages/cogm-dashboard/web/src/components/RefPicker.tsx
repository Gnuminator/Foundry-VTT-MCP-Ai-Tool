// The Pick… button next to a Tool runner field that names something (x-foundry-ref): a list of
// what exists now from list-ref-choices, with a filter box. Port of the old page's buildRefPicker
// (public/app.js) on its markup and styles (.ref-picker, .ref-menu, .ref-item, ...). The field
// still takes typed text; the hint under it names what the value points at, also for a prefilled
// value (the old page showed the name only after a pick or typing).
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import { callTool, errorText } from '../lib/api';
import { fieldValues, refValue, type RefChoice, type ToolRef } from '../lib/toolForm';
import { usage } from '../lib/usage';

/** Kinds that list nothing until the GM types a search (large sets). */
const SEARCH_KINDS = new Set(['compendium-entry', 'document']);
const MIN_SEARCH = 2;

/** A listed row: the choice, the heading it sits under, and a fixed value for an extra. */
interface Row {
  choice: RefChoice;
  group: string;
  literal?: string;
}

interface Loaded {
  rows: Row[];
  notes: string[];
}

/** One list-ref-choices call per kind, in parallel; a failed kind becomes a note, not an error. */
async function loadChoices(
  kinds: string[],
  ref: ToolRef,
  parent: string,
  showAll: boolean,
  query: string
): Promise<Loaded> {
  const results = await Promise.all(
    kinds.map(kind =>
      callTool<{ choices?: RefChoice[]; truncated?: boolean; note?: string } | null>(
        'list-ref-choices',
        {
          kind,
          ...(ref.filter && !(showAll && kind === 'actor') ? { filter: ref.filter } : {}),
          ...(parent ? { parent } : {}),
          ...(query ? { query } : {}),
          limit: 200,
        }
      ).then(
        r => ({ kind, choices: r?.choices ?? [], truncated: r?.truncated === true, note: r?.note }),
        (err: unknown) => ({
          kind,
          choices: [] as RefChoice[],
          truncated: false,
          note: `✗ ${errorText(err)}`,
        })
      )
    )
  );
  const notes = results.map(r => r.note).filter((n): n is string => Boolean(n));
  if (results.some(r => r.truncated)) notes.push('More exist: type to narrow the list.');
  const rows = results.flatMap(r =>
    r.choices.map(c => ({ choice: c, group: c.group ?? (kinds.length > 1 ? r.kind : '') }))
  );
  return { rows, notes };
}

export interface RefPickerProps {
  /** The control's id; the Pick… button is `${fieldId}-pick`. */
  fieldId: string;
  refSpec: ToolRef;
  /** A list parameter: several rows can be ticked, one value per line. */
  multiple: boolean;
  value: string;
  onChange: (value: string) => void;
  /** The parent parameter's value (its first line), which narrows the list. */
  parentValue: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The names seen for this field's values, kept by the form across reloads and tool switches (a
   * search moves on, the pick stays named); the confirm window reads them too.
   */
  names: Map<string, string>;
  /** The input or textarea. */
  children: ReactNode;
}

export function RefPicker({
  fieldId,
  refSpec: ref,
  multiple,
  value,
  onChange,
  parentValue,
  open,
  onOpenChange,
  names,
  children,
}: RefPickerProps): JSX.Element {
  const kinds = useMemo(() => (Array.isArray(ref.kind) ? ref.kind : [ref.kind]), [ref.kind]);
  const needsSearch = kinds.every(k => SEARCH_KINDS.has(k));
  // Actor pickers are narrowed to the tool's actor types (I-017); the GM can lift that.
  const narrowsActors = kinds.includes('actor') && Boolean(ref.filter);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const [searchFor, setSearchFor] = useState('');
  const values = fieldValues(value, multiple);

  // A search kind waits 250 ms after the last letter, and for two letters.
  useEffect(() => {
    if (!needsSearch) return;
    const q = filter.trim();
    if (q.length < MIN_SEARCH) {
      setSearchFor('');
      return;
    }
    const timer = setTimeout(() => setSearchFor(q), 250);
    return (): void => clearTimeout(timer);
  }, [filter, needsSearch]);

  // Loads when the menu opens, and once for a value already in the field (a prefill), so the hint
  // can name it. The key holds everything the list depends on, so an answer for an older search
  // or parent never replaces a newer one.
  const query = needsSearch ? searchFor : '';
  const choices = useQuery({
    queryKey: ['ref-choices', kinds, ref.filter ?? null, parentValue, showAll, query],
    queryFn: () => loadChoices(kinds, ref, parentValue, showAll, query),
    enabled: needsSearch ? open && query.length >= MIN_SEARCH : open || values.length > 0,
    staleTime: 0,
    retry: false,
  });
  // Every opening shows what exists now.
  const refetch = choices.refetch;
  useEffect(() => {
    if (open && !needsSearch) void refetch();
  }, [open, needsSearch, refetch]);

  const extras = useMemo<Row[]>(
    () =>
      (ref.extra ?? []).map(e => ({
        choice: { id: e.value, name: e.label },
        group: 'Special',
        literal: e.value,
      })),
    [ref.extra]
  );
  const searching = needsSearch && query.length < MIN_SEARCH;
  const rows = useMemo<Row[]>(
    () => [...extras, ...(searching ? [] : (choices.data?.rows ?? []))],
    [extras, searching, choices.data]
  );
  const valueOf = (row: Row): string => row.literal ?? refValue(ref, row.choice);

  for (const row of rows) names.set(valueOf(row), row.choice.name);

  const hint = ((): string => {
    if (values.length === 0) return '';
    if (ref.value === 'name') return values.length > 1 ? `${values.length} selected` : '';
    const named = values.map(v => names.get(v));
    if (!multiple) return named[0] ?? '';
    return values.map((v, i) => named[i] ?? v).join(', ');
  })();

  // A click anywhere outside closes the menu; the listener goes with it. A click, not the old
  // page's mousedown: the menu sits in the form, so closing it on mousedown moved Run (or the
  // next field) away under the pointer and the click was lost.
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent): void => {
      if (e.target instanceof Node && wrap.current?.contains(e.target)) return;
      onOpenChange(false);
    };
    document.addEventListener('click', outside, true);
    return (): void => document.removeEventListener('click', outside, true);
  }, [open, onOpenChange]);

  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) searchBox.current?.focus();
  }, [open]);

  const toggle = (): void => {
    if (open) {
      onOpenChange(false);
      return;
    }
    usage().track('action', 'dash.tools.pick-open');
    setFilter('');
    setSearchFor('');
    onOpenChange(true);
  };

  const pick = (row: Row): void => {
    usage().track('action', 'dash.tools.pick-choice');
    const v = valueOf(row);
    if (multiple) {
      const next = values.includes(v) ? values.filter(x => x !== v) : [...values, v];
      onChange(next.join('\n'));
      return;
    }
    onChange(v);
    onOpenChange(false);
    document.getElementById(fieldId)?.focus();
  };

  const counts = new Map<string, number>();
  for (const { choice } of rows) counts.set(choice.name, (counts.get(choice.name) ?? 0) + 1);
  const q = needsSearch ? '' : filter.trim().toLowerCase();
  const shown = rows.filter(
    ({ choice, group }) =>
      !q || `${choice.name} ${choice.detail ?? ''} ${group} ${choice.id}`.toLowerCase().includes(q)
  );
  const note = searching
    ? 'Type at least 2 letters to search.'
    : choices.isFetching
      ? 'Loading…'
      : (choices.data?.notes ?? []).join(' · ');
  const empty = rows.length
    ? 'Nothing matches.'
    : needsSearch
      ? 'Type at least 2 letters.'
      : choices.isFetching
        ? ''
        : 'Nothing to pick.';

  let lastGroup: string | null = null;
  return (
    <div className="ref-picker" ref={wrap}>
      <div className="ref-row">
        {children}
        <button
          type="button"
          className="btn btn-small ref-open"
          id={`${fieldId}-pick`}
          title="Choose from what exists now (you can still type)"
          aria-expanded={open}
          aria-controls={open ? `${fieldId}-menu` : undefined}
          onClick={toggle}
        >
          Pick…
        </button>
      </div>
      <div className="ref-hint" id={`${fieldId}-hint`} aria-live="polite">
        {hint}
      </div>
      {open && (
        <div className="ref-menu" id={`${fieldId}-menu`}>
          <input
            ref={searchBox}
            type="search"
            className="ref-search field-control"
            autoComplete="off"
            aria-label="Filter choices"
            placeholder={needsSearch ? 'Type to search…' : 'Filter…'}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            // Enter here picks nothing and must not submit the tool's form.
            onKeyDown={e => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
          <div className="ref-note">{note}</div>
          {narrowsActors && !showAll && (
            <button
              type="button"
              className="btn btn-small ref-all"
              data-track="dash.tools.show-all-actors"
              title="List every actor, not only the kinds this tool is for"
              onClick={() => setShowAll(true)}
            >
              Show all actors
            </button>
          )}
          <div
            className="ref-list"
            role="listbox"
            aria-label="Choices"
            aria-multiselectable={multiple || undefined}
          >
            {shown.length === 0 ? (
              <p className="ref-empty">{empty}</p>
            ) : (
              shown.map((row, i) => {
                const { choice, group } = row;
                const heading = group !== lastGroup && group ? group : null;
                lastGroup = group;
                const v = valueOf(row);
                const selected = values.includes(v);
                const sameName =
                  ref.value === 'name' &&
                  row.literal === undefined &&
                  (counts.get(choice.name) ?? 0) > 1;
                return (
                  <Fragment key={`${group}:${v}:${i}`}>
                    {heading && <div className="ref-group">{heading}</div>}
                    <button
                      type="button"
                      className="ref-item"
                      role="option"
                      aria-selected={selected}
                      title={ref.value === 'name' ? choice.name : `${choice.name} → ${v}`}
                      onClick={() => pick(row)}
                    >
                      <span className="ref-check">{selected ? '✓' : ''}</span>
                      <span className="ref-name">
                        {choice.name}
                        {choice.hidden && (
                          <>
                            {' '}
                            <span className="ref-flag" title="Hidden from players">
                              hidden
                            </span>
                          </>
                        )}
                      </span>
                      <span className="ref-detail">
                        {choice.detail ?? ''}
                        {sameName && (
                          <>
                            {' '}
                            <span
                              className="ref-warn"
                              title="The tool matches by name; several share it"
                            >
                              same name ×{counts.get(choice.name)}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  </Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
