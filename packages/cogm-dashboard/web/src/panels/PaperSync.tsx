// After a paper night (Paper nights B): one card per player character, filled in from the sheet in
// Foundry (the values printed at the start of the night). The GM types what each player reads out
// from the paper sheet; Plan builds one guarded plan per character through plan-paper-sync, the
// confirm window shows what it changes, and Apply writes it with one Undo in Recent Changes. Only
// the fields that were changed are sent. GM only: the sheets come from /api/party-sheets and show
// exact hit points. The change itself needs GM Actions and the "AI Tool: Paper sync (writes)" switch.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX, type ReactNode } from 'react';

import { focusedElement, useConfirm } from '../components/ConfirmDialog';
import { Drawer, DrawerClose } from '../components/Drawer';
import { RefPicker } from '../components/RefPicker';
import { useToast } from '../components/Toasts';
import { api, callTool, errorText } from '../lib/api';
import { GAME_STATE_KEY, useGuardedTools } from '../lib/guarded';
import {
  CONDITIONS,
  COINS,
  buildRequest,
  initialDraft,
  isEdited,
  localDate,
  planLines,
  resourceRows,
  singleHitDiceClass,
  slotKey,
  slotLabel,
  type PaperDraft,
  type PaperPlan,
  type SheetLike,
} from '../lib/paperSync';
import { useDashboardSettings } from '../lib/stream';
import type { ToolRef } from '../lib/toolForm';
import { usage } from '../lib/usage';
import { Button, Card, QueryState } from '../ui';

import styles from './PaperSync.module.css';

interface PartySheets {
  sheets?: SheetLike[];
  unreadable?: string[];
}

/** Under GAME_STATE_KEY: an applied sync or an undo reloads the sheets while the drawer is open. */
export const PAPER_SHEETS_KEY = [...GAME_STATE_KEY, 'paper-sheets'] as const;

/** The item picker: a compendium item to add to the character (the tool's own picker, kept). */
const ITEM_REF: ToolRef = {
  kind: 'compendium-entry',
  value: 'uuid',
  filter: { documentName: 'Item' },
};

type Notice = { kind: 'ok' | 'err'; text: string } | null;

/** A number box: text, so a half-typed value stays; the sheet's own value is shown beside it. */
function NumberField({
  label,
  value,
  was,
  onChange,
}: {
  label: string;
  value: string;
  was: number | string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className={styles['field']}>
      <span>
        {label} <span className={styles['was']}>(was {was})</span>
      </span>
      <input
        className="field-control"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className={styles['group']}>
      <h4 className={styles['groupTitle']}>{title}</h4>
      {children}
    </div>
  );
}

function CharacterCard({ sheet }: { sheet: SheetLike }): JSX.Element {
  const guarded = useGuardedTools();
  const askConfirm = useConfirm();
  const [draft, setDraft] = useState<PaperDraft>(() => initialDraft(sheet));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const names = useRef(new Map<string, string>());
  const nextKey = useRef(1);

  const built = buildRequest(sheet, draft);
  const edited = isEdited(sheet, draft);
  const patch = (change: Partial<PaperDraft>): void => {
    setNotice(null);
    setDraft(d => ({ ...d, ...change }));
  };
  const resources = resourceRows(sheet);
  const single = singleHitDiceClass(sheet);
  const classes = sheet.classes.filter(c => c.levels > 0);

  const plan = async (): Promise<void> => {
    if (busyRef.current || !built.ok || built.changed === 0) return;
    const startedFrom = focusedElement();
    if (guarded.gated('plan-paper-sync')) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      let planned: PaperPlan | null;
      try {
        planned = await callTool<PaperPlan | null>('plan-paper-sync', { ...built.request });
      } catch (err) {
        usage().trackTool('plan-paper-sync', 'error');
        const text = errorText(err);
        // The module answers an edit that matches Foundry with "Nothing to change ...": not a failure.
        setNotice({ kind: /nothing to change/i.test(text) ? 'ok' : 'err', text });
        return;
      }
      usage().trackTool('plan-paper-sync', 'ok');
      if (!planned || typeof planned.planId !== 'string' || !planned.planId) {
        setNotice({ kind: 'ok', text: 'Nothing differs from Foundry. Nothing was planned.' });
        return;
      }
      const destructive = planned.risk === 'destructive';
      const ok = await askConfirm({
        summary: planned.summary ?? `Sync ${sheet.name} from the paper sheet`,
        diff: planLines(planned),
        destructive,
        returnTo: startedFrom,
      });
      if (!ok) {
        usage().trackTool('apply-planned-change', 'cancelled');
        setNotice({ kind: 'ok', text: 'Not applied. Nothing was changed in Foundry.' });
        return;
      }
      const outcome = await guarded.applyApproved(planned.planId, destructive);
      if (outcome.status === 'done') {
        setNotice({
          kind: 'ok',
          text: `Applied: ${planned.summary ?? sheet.name}. It is in Recent Changes with an Undo.`,
        });
      } else if (outcome.status === 'failed') {
        setNotice({ kind: 'err', text: outcome.error });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const setIn =
    (key: 'slots' | 'hitDice' | 'resources' | 'coins' | 'inventory', id: string) =>
    (value: string): void =>
      patch({ [key]: { ...draft[key], [id]: value } });

  const toggleCondition = (id: string): void =>
    patch({
      conditions: draft.conditions.includes(id)
        ? draft.conditions.filter(c => c !== id)
        : [...draft.conditions, id],
    });

  const setAdded = (key: number, change: Partial<PaperDraft['added'][number]>): void =>
    patch({ added: draft.added.map(a => (a.key === key ? { ...a, ...change } : a)) });

  const hp = sheet.hp;
  return (
    <Card
      title={sheet.name}
      aside={sheet.player ?? undefined}
      data-sheet={sheet.id}
      aria-label={`Paper sheet of ${sheet.name}`}
    >
      <Group title="Hit points">
        <div className={styles['grid']}>
          <NumberField
            label={`HP (max ${hp.max})`}
            value={draft.hp}
            was={hp.value}
            onChange={v => patch({ hp: v })}
          />
          <NumberField
            label="Temp HP"
            value={draft.tempHp}
            was={hp.temp}
            onChange={v => patch({ tempHp: v })}
          />
        </div>
      </Group>
      {sheet.slots.length > 0 && (
        <Group title="Spell slots left">
          <div className={styles['grid']}>
            {sheet.slots.map(s => (
              <NumberField
                key={slotKey(s)}
                label={`${slotLabel(s)} (of ${s.max})`}
                value={draft.slots[slotKey(s)] ?? ''}
                was={s.value}
                onChange={setIn('slots', slotKey(s))}
              />
            ))}
          </div>
        </Group>
      )}
      <Group title="Hit dice left">
        <div className={styles['grid']}>
          {single ? (
            <NumberField
              label={`${classes[0]?.name ?? 'Hit dice'} (of ${sheet.hitDice.max})`}
              value={draft.hitDice[''] ?? ''}
              was={sheet.hitDice.value}
              onChange={setIn('hitDice', '')}
            />
          ) : (
            classes.map(c => (
              <NumberField
                key={c.name}
                label={`${c.name} ${c.hitDie ?? ''}`.trim()}
                value={draft.hitDice[c.name] ?? ''}
                was={`${sheet.hitDice.value} left in all`}
                onChange={setIn('hitDice', c.name)}
              />
            ))
          )}
        </div>
      </Group>
      {resources.length > 0 && (
        <Group title="Class resources and item uses left">
          <div className={styles['grid']}>
            {resources.map(r => (
              <NumberField
                key={r.name}
                label={`${r.name} (of ${r.max})`}
                value={draft.resources[r.name] ?? ''}
                was={r.value}
                onChange={setIn('resources', r.name)}
              />
            ))}
          </div>
        </Group>
      )}
      <Group title="Coins">
        <div className={styles['grid']}>
          {COINS.map(c => (
            <NumberField
              key={c}
              label={c.toUpperCase()}
              value={draft.coins[c] ?? ''}
              was={sheet.currency[c] ?? 0}
              onChange={setIn('coins', c)}
            />
          ))}
        </div>
      </Group>
      <Group title="Exhaustion, inspiration, death saves">
        <div className={styles['grid']}>
          <NumberField
            label="Exhaustion (0 to 6)"
            value={draft.exhaustion}
            was={sheet.exhaustion}
            onChange={v => patch({ exhaustion: v })}
          />
          <label className={styles['field']}>
            <span>Inspiration</span>
            <input
              type="checkbox"
              checked={draft.inspiration}
              onChange={e => patch({ inspiration: e.target.checked })}
            />
          </label>
          <label className={styles['field']}>
            <span>
              Death saves back to 0{' '}
              <span className={styles['was']}>
                (now {sheet.deathSaves.success} saved, {sheet.deathSaves.failure} failed)
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.resetDeathSaves}
              onChange={e => patch({ resetDeathSaves: e.target.checked })}
            />
          </label>
        </div>
      </Group>
      <Group title="Conditions now">
        <div className={styles['chips']} role="group" aria-label="Conditions now">
          {CONDITIONS.map(id => (
            <Button
              key={id}
              type="button"
              size="sm"
              className={styles['chip']}
              aria-pressed={draft.conditions.includes(id)}
              onClick={() => toggleCondition(id)}
            >
              {id}
            </Button>
          ))}
        </div>
      </Group>
      <Group title="Inventory (quantity now, 0 removes)">
        <div className={styles['inventory']}>
          {sheet.inventory.map(i => (
            <NumberField
              key={i.id}
              label={i.name}
              value={draft.inventory[i.id] ?? ''}
              was={i.quantity}
              onChange={setIn('inventory', i.id)}
            />
          ))}
        </div>
        {draft.added.map(a => {
          const fieldId = `paper-${sheet.id}-add-${a.key}`;
          return (
            <div key={a.key} className={styles['added']}>
              <RefPicker
                fieldId={fieldId}
                refSpec={ITEM_REF}
                multiple={false}
                value={a.uuid}
                onChange={v => setAdded(a.key, { uuid: v })}
                parentValue=""
                open={pickerOpen === a.key}
                onOpenChange={o => setPickerOpen(o ? a.key : null)}
                names={names.current}
              >
                <input
                  id={fieldId}
                  className="field-control"
                  type="text"
                  autoComplete="off"
                  placeholder="New item (Pick… or paste a uuid)"
                  aria-label="New item"
                  value={a.uuid}
                  onChange={e => setAdded(a.key, { uuid: e.target.value })}
                />
              </RefPicker>
              <input
                className="field-control"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                aria-label="How many"
                value={a.quantity}
                onChange={e => setAdded(a.key, { quantity: e.target.value })}
              />
              <Button
                type="button"
                size="sm"
                data-track="dash.paper.remove-item"
                onClick={() => patch({ added: draft.added.filter(x => x.key !== a.key) })}
              >
                Remove
              </Button>
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            size="sm"
            data-track="dash.paper.add-item"
            onClick={() =>
              patch({
                added: [...draft.added, { key: nextKey.current++, uuid: '', quantity: '1' }],
              })
            }
          >
            + Add an item
          </Button>
        </div>
      </Group>
      {!built.ok && (
        <ul className={styles['problems']} aria-label="Check these before planning">
          {built.problems.map(p => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {notice && (
        <p className={styles[notice.kind === 'err' ? 'noticeErr' : 'notice']} role="status">
          {notice.text}
        </p>
      )}
      <div className={styles['actions']}>
        <Button
          type="button"
          variant="primary"
          data-track="dash.paper.plan"
          disabled={busy || !built.ok || built.changed === 0}
          onClick={() => void plan()}
        >
          {built.ok && built.changed > 0
            ? `Plan ${built.changed} ${built.changed === 1 ? 'change' : 'changes'}`
            : 'Plan'}
        </Button>
        <Button
          type="button"
          variant="quiet"
          data-track="dash.paper.reset"
          disabled={busy || !edited}
          onClick={() => {
            setNotice(null);
            setDraft(initialDraft(sheet));
          }}
        >
          Back to Foundry&apos;s values
        </Button>
      </div>
    </Card>
  );
}

/** A sheet's content as a key: a card starts again from Foundry when its sheet changed. */
const sheetKey = (s: SheetLike): string => `${s.id}:${JSON.stringify(s)}`;

/** The night: the day the table played on paper, and the log entry for it. */
function NightBar({ date, onDate }: { date: string; onDate: (date: string) => void }): JSX.Element {
  const toast = useToast();
  const [logged, setLogged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const askConfirm = useConfirm();
  const log = async (): Promise<void> => {
    const startedFrom = focusedElement();
    // The log is not read first, so the GM says whether the night is already in it: a second
    // paper night on the same date is counted twice in the stats and Pre-flight asks for its sync.
    const ok = await askConfirm({
      summary: `Put a paper night on ${date} in the play log?`,
      diff: [
        'Skip this if the night was already started in the dashboard or by Claude: it would count as a second paper night.',
      ],
      destructive: false,
      returnTo: startedFrom,
    });
    if (!ok) return;
    setBusy(true);
    try {
      // A log-only call (no GM Actions): a paper session from that day, started and ended. The
      // button stays used once the start is written, so a failed end is never retried as a new start.
      await callTool('mark-play-session', { action: 'start', mode: 'paper', date });
      setLogged(date);
      await callTool('mark-play-session', { action: 'end', mode: 'paper', date });
      toast(`✓ Paper night ${date} is in the play log`, 'ok');
    } catch (err) {
      toast(`✗ mark-play-session: ${errorText(err)}`, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles['nightBar']}>
      <label className={styles['nightField']}>
        Which night was this?
        <input
          className="field-control"
          type="date"
          value={date}
          max={localDate()}
          onChange={e => e.target.value && onDate(e.target.value)}
        />
      </label>
      <Button
        type="button"
        data-track="dash.paper.log-night"
        disabled={busy || logged === date}
        title="Puts a paper night on this date in the play log, so the stats and Pre-flight know it. Skip it when the night is already logged."
        onClick={() => void log()}
      >
        {logged === date ? 'In the play log' : 'Log this night'}
      </Button>
    </div>
  );
}

export function PaperSyncDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const settings = useDashboardSettings();
  const [date, setDate] = useState(() => localDate());
  // Loads on every opening; a change made in Foundry shows on Refresh. No refetch on focus: it
  // would start a card over while the GM is typing.
  const sheets = useQuery({
    queryKey: PAPER_SHEETS_KEY,
    queryFn: async () => {
      const body = await api<PartySheets>('/api/party-sheets');
      return {
        sheets: Array.isArray(body.sheets) ? body.sheets : [],
        unreadable: Array.isArray(body.unreadable) ? body.unreadable : [],
      };
    },
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const list = sheets.isError ? [] : (sheets.data?.sheets ?? []);
  const unreadable = sheets.data?.unreadable ?? [];

  const sub = sheets.isFetching
    ? 'Loading…'
    : sheets.isError
      ? 'GM only. The sheets did not load.'
      : `GM only. ${list.length} ${list.length === 1 ? 'character' : 'characters'}. Type what each player reads from the paper sheet.`;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="paper-drawer"
      title="📝 After a paper night"
      sub={sub}
      close={<DrawerClose data-track="dash.paper.close" />}
      bodyClassName="paper-body"
      actions={
        <Button
          variant="primary"
          id="paper-refresh"
          data-track="dash.paper.refresh"
          disabled={sheets.isFetching}
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: PAPER_SHEETS_KEY });
          }}
        >
          ↻ Refresh
        </Button>
      }
    >
      <NightBar date={date} onDate={setDate} />
      {settings?.gmActionsEnabled !== true && (
        <div className="preflight-summary pf-warn" id="paper-gate">
          GM Actions are off. Plan asks Pre-flight to turn them on. The sync also needs the &quot;AI
          Tool: Paper sync (writes)&quot; switch in Foundry&apos;s module settings.
        </div>
      )}
      {unreadable.length > 0 && (
        <div className="preflight-summary pf-warn">
          Could not read the sheets of {unreadable.join(', ')}.
        </div>
      )}
      <p className="pf-detail">
        Each field starts from what Foundry has now. Change only what differs from the paper sheet;
        a field you leave alone is not written. One plan per character, each with its own Undo. XP,
        level, class and max HP are never synced.
      </p>
      <div id="paper-cards" className={styles['cards']}>
        <QueryState
          query={sheets}
          errorLabel="Couldn't load the sheets"
          isEmpty={d => d.sheets.length === 0}
          empty={() =>
            'No player characters to sync. A player needs a character linked to their user in Foundry.'
          }
        >
          {() => (
            <>
              {list.map(s => (
                <CharacterCard key={sheetKey(s)} sheet={s} />
              ))}
            </>
          )}
        </QueryState>
      </div>
    </Drawer>
  );
}
