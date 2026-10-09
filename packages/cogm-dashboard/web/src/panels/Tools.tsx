// The Tool runner (🛠 Tools): every bridge tool the dashboard can see (GET /api/tools), grouped by
// category, and one tool as a form built from its input schema, with Pick… lists for parameters
// that name something. Reads run at once. A plan-* tool is planned and then applied after the
// confirm window, always (a plan typed by hand is never a one-click change, and Enter in a field
// submits the form); any other write goes through the same window. Port of the old page's tool
// drawer (public/app.js openTool, buildForm, submitToolForm, showToolResult). GM only.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';

import { Drawer, DrawerClose, raiseDrawer } from '../components/Drawer';
import { RefPicker } from '../components/RefPicker';
import { useToast } from '../components/Toasts';
import { api, callTool, errorText } from '../lib/api';
import {
  GAME_STATE_KEY,
  GmActionsGateContext,
  argLines,
  failCode,
  useGuardedTools,
  type GuardedOutcome,
} from '../lib/guarded';
import { SETTINGS_KEY, useDashboardSettings, type DashboardSettings } from '../lib/stream';
import {
  collectArgs,
  fieldValues,
  groupTools,
  isPlanTool,
  isQueueCall,
  kindOf,
  paramsOf,
  pickerRef,
  startDraft,
  type Draft,
  type FieldValue,
  type ParamDef,
  type ToolInfo,
} from '../lib/toolForm';
import { usage } from '../lib/usage';

/** Another panel asks for a tool with its form filled in (Handouts: + Queue a page). */
export interface ToolRequest {
  name: string;
  prefill: Record<string, unknown>;
  /** A new number for each request, so the same request twice opens the form twice. */
  seq: number;
}

const TOOLS_KEY = ['tools'] as const;

const GATE_TEXT = 'GM Actions are off. Enable GM Actions at the top of the Tool Runner.';

/** What shows under the form: the answer or the error. */
interface ToolResult {
  tool: string;
  ok: boolean;
  payload: unknown;
}

/** What is wrong with the form: the text under Run and the fields to mark. */
interface Problems {
  tool: string;
  text: string;
  fields: string[];
}

export function ToolsDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ToolRequest | null;
}): JSX.Element {
  // A change refused for GM Actions points at the gate bar in this drawer, not at Pre-flight.
  // Open, the drawer comes to the top and the bar takes the focus once it has drawn (a refusal
  // from the server draws it with the same render). An Undo from a toast can be refused after the
  // drawer closed: it opens again, and the bar takes the focus in place of Radix's open autofocus
  // (which would otherwise run after anything done here).
  const gateButton = useRef<HTMLButtonElement>(null);
  const gatePending = useRef(false);
  const [gateAsked, setGateAsked] = useState(0);
  const { open, onOpenChange } = props;
  // Read when the gate is asked for: an Undo toast keeps the gate from when its change ran.
  const isOpen = useRef(open);
  useLayoutEffect(() => {
    isOpen.current = open;
  });
  const focusGate = useCallback(() => {
    gatePending.current = true;
    if (!isOpen.current) {
      onOpenChange(true);
      return;
    }
    raiseDrawer('tools-drawer');
    setGateAsked(n => n + 1);
  }, [onOpenChange]);
  useEffect(() => {
    if (!gatePending.current || !isOpen.current) return;
    gatePending.current = false;
    gateButton.current?.focus();
  }, [gateAsked]);
  const onOpenAutoFocus = useCallback((event: Event) => {
    if (!gatePending.current) return;
    gatePending.current = false;
    if (!gateButton.current) return;
    event.preventDefault();
    gateButton.current.focus();
  }, []);
  return (
    <GmActionsGateContext.Provider value={focusGate}>
      <ToolRunner {...props} gateButton={gateButton} onOpenAutoFocus={onOpenAutoFocus} />
    </GmActionsGateContext.Provider>
  );
}

function ToolRunner({
  open,
  onOpenChange,
  request,
  gateButton,
  onOpenAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ToolRequest | null;
  gateButton: RefObject<HTMLButtonElement | null>;
  onOpenAutoFocus: (event: Event) => void;
}): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const guarded = useGuardedTools();
  const settings = useDashboardSettings();
  const gmActionsOff = settings?.gmActionsEnabled !== true;

  // The server keeps the catalog for 60 seconds; an opening after that asks again.
  const catalog = useQuery({
    queryKey: TOOLS_KEY,
    queryFn: () => api<{ tools?: ToolInfo[]; gmActionsEnabled?: boolean }>('/api/tools'),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const tools = catalog.data?.tools;

  // Until the stream sends settings, the catalog's GM Actions state stands in (the stream wins).
  const catalogGmActions = catalog.data?.gmActionsEnabled;
  useEffect(() => {
    if (typeof catalogGmActions !== 'boolean') return;
    queryClient.setQueryData<DashboardSettings | null>(
      SETTINGS_KEY,
      old => old ?? { gmActionsEnabled: catalogGmActions }
    );
  }, [queryClient, catalogGmActions]);

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.tools.view');
    return (): void => usage().endView('dash.tools.view');
  }, [open]);

  // The page keeps every tool's form while it is open, closed or another tool is shown: a draft
  // is never lost to a misclick.
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [result, setResult] = useState<ToolResult | null>(null);
  const [problems, setProblems] = useState<Problems | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // The names the pickers saw, per tool and field: what the confirm window shows for an id.
  const names = useRef(new Map<string, Map<string, string>>());
  const namesOf = (tool: string, key: string): Map<string, string> => {
    const id = `${tool}\n${key}`;
    let map = names.current.get(id);
    if (!map) {
      map = new Map();
      names.current.set(id, map);
    }
    return map;
  };

  const tool = current ? tools?.find(t => t.name === current) : undefined;

  // Where focus goes after the view changes: the form's first field, or the tool in the list.
  const [focusNext, setFocusNext] = useState<'form' | { tool: string } | null>(null);
  useEffect(() => {
    if (!focusNext) return;
    setFocusNext(null);
    const target =
      focusNext === 'form'
        ? document.querySelector<HTMLElement>(
            '#tool-form .field-control, #tool-form input, #tool-run'
          )
        : document.querySelector<HTMLElement>(
            `#tool-list [data-tool="${CSS.escape(focusNext.tool)}"]`
          );
    target?.focus();
  }, [focusNext]);

  const openTool = useCallback((t: ToolInfo, prefill?: Record<string, unknown>): void => {
    setCurrent(t.name);
    setOpenPicker(null);
    setResult(null);
    setProblems(null);
    setDrafts(d => (prefill || !d[t.name] ? { ...d, [t.name]: startDraft(t, prefill) } : d));
    setFocusNext('form');
  }, []);

  // A request from another panel: that tool, its form filled in fresh (it never runs by itself).
  // The old page left the last form under the list when the tool was missing.
  const handled = useRef(0);
  useEffect(() => {
    if (!request || !tools || handled.current === request.seq) return;
    handled.current = request.seq;
    const t = tools.find(x => x.name === request.name);
    if (!t) {
      toast(`Tool "${request.name}" isn't in the catalog.`, 'warn');
      setCurrent(null);
      return;
    }
    openTool(t, request.prefill);
  }, [request, tools, toast, openTool]);

  const setField = (key: string, value: FieldValue): void => {
    if (!tool) return;
    const name = tool.name;
    setDrafts(d => ({ ...d, [name]: { ...(d[name] ?? startDraft(tool)), [key]: value } }));
  };

  const [enabling, setEnabling] = useState(false);
  const enableGmActions = (): void => {
    setEnabling(true);
    api<DashboardSettings>('/api/control', {
      method: 'POST',
      body: JSON.stringify({ action: 'set-gm-actions', value: true }),
    })
      .then(
        data => {
          queryClient.setQueryData<DashboardSettings>(SETTINGS_KEY, old => ({
            ...old,
            gmActionsEnabled: data.gmActionsEnabled,
          }));
          toast('✓ GM Actions are on', 'ok');
        },
        (err: unknown) => toast(`✗ Couldn't turn on GM Actions: ${errorText(err)}`, 'err')
      )
      .finally(() => setEnabling(false));
  };

  /**
   * The confirm window's lines: the args, with the names the pickers know for their values and
   * the value itself after the name, so two scenes or tokens of the same name stay apart.
   */
  const confirmLines = (t: ToolInfo, args: Record<string, unknown>): string[] =>
    Object.keys(args).length === 0
      ? argLines(args)
      : Object.entries(args).map(([key, value]) => {
          const known = namesOf(t.name, key);
          const named = (v: unknown): string => {
            if (typeof v !== 'string') return JSON.stringify(v);
            const name = known.get(v);
            return name === undefined || name === v ? v : `${name} (${v})`;
          };
          return `${key}: ${Array.isArray(value) ? value.map(named).join(', ') : named(value)}`;
        });

  const fromOutcome = (name: string, outcome: GuardedOutcome): ToolResult | null => {
    if (outcome.status === 'done') return { tool: name, ok: true, payload: outcome.result };
    if (outcome.status === 'failed') return { tool: name, ok: false, payload: outcome.error };
    // Refused or cancelled: nothing ran, the form keeps its values for another try.
    return null;
  };

  const execute = async (
    t: ToolInfo,
    args: Record<string, unknown>
  ): Promise<ToolResult | null> => {
    const name = t.name;
    if (isPlanTool(name) && !isQueueCall(name, args)) {
      return fromOutcome(
        name,
        await guarded.plan(name, args, { alwaysConfirm: true, gateText: GATE_TEXT })
      );
    }
    if (t.mutates !== 'read') {
      const lines = confirmLines(t, args);
      return fromOutcome(
        name,
        await guarded.write(name, args, t.mutates, { gateText: GATE_TEXT, lines })
      );
    }
    // A read, or a queue change that touches nothing in Foundry: runs at once, no GM Actions.
    try {
      const answer = await callTool<unknown>(name, args);
      usage().trackTool(name, 'ok');
      if (isQueueCall(name, args)) {
        const note = (answer as { note?: unknown } | null)?.note;
        toast(typeof note === 'string' ? `✓ ${note}` : `✓ ${name}`, 'ok');
        void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });
      }
      return { tool: name, ok: true, payload: answer };
    } catch (err) {
      usage().trackTool(name, 'error', failCode(err));
      return { tool: name, ok: false, payload: errorText(err) };
    }
  };

  const submit = (): void => {
    if (!tool || busyRef.current) return;
    const collected = collectArgs(tool, drafts[tool.name] ?? startDraft(tool));
    if ('problems' in collected) {
      setProblems({
        tool: tool.name,
        text: collected.problems.join(' '),
        fields: collected.fields,
      });
      const first = collected.fields[0];
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setProblems(null);
    setResult(null);
    setOpenPicker(null);
    busyRef.current = true;
    setBusy(true);
    // Called before the re-render: the guarded path reads which element had focus.
    void execute(tool, collected.args)
      .then(shown => setResult(shown))
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  // Escape closes an open Pick… list first (focus back on its button), then the drawer.
  const escapeKey = (): boolean => {
    if (!openPicker) return false;
    usage().track('shortcut', 'dash.shortcut.escape-picker');
    const button = document.getElementById(`${fieldId(openPicker)}-pick`);
    setOpenPicker(null);
    button?.focus();
    return true;
  };

  const browser = (
    <div className="tool-browser" id="tool-browser">
      <input
        id="tool-search"
        className="ask-input"
        data-track="dash.tools.search"
        type="text"
        placeholder="Search tools…"
        aria-label="Search tools"
        autoComplete="off"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="tool-list" id="tool-list">
        {catalog.isError && !tools ? (
          <p className="empty">Couldn&apos;t load tools: {errorText(catalog.error)}</p>
        ) : !tools ? (
          <p className="empty">Loading tools…</p>
        ) : (
          ((): ReactNode => {
            const groups = groupTools(tools, search);
            if (groups.length === 0) return <p className="empty">No tools match that search.</p>;
            return groups.map(([cat, list]) => (
              <div key={cat} role="group" aria-label={cat} className="tool-group">
                <div className="tool-cat">{cat}</div>
                {list.map(t => {
                  const kind = kindOf(t);
                  return (
                    <button
                      key={t.name}
                      type="button"
                      className="tool-item"
                      data-track="dash.tools.open-tool"
                      data-tool={t.name}
                      onClick={() => openTool(t)}
                    >
                      <span className="tool-item-main">
                        <span className="tool-item-name">{t.name}</span>
                        <span className="tool-item-desc">{t.description}</span>
                      </span>
                      <span className={`tool-kind ${kind.className}`}>{kind.label}</span>
                    </button>
                  );
                })}
              </div>
            ));
          })()
        )}
      </div>
    </div>
  );

  const detail = tool ? (
    <div className="tool-detail" id="tool-detail">
      <button
        type="button"
        className="link-btn"
        id="tool-back"
        data-track="dash.tools.back"
        onClick={() => {
          setOpenPicker(null);
          setCurrent(null);
          setFocusNext({ tool: tool.name });
        }}
      >
        ‹ All tools
      </button>
      <div className="tool-detail-head">
        <h3 id="tool-detail-name">{tool.name}</h3>
        <span className={`tool-kind ${kindOf(tool).className}`} id="tool-detail-kind">
          {kindOf(tool).label}
        </span>
      </div>
      <p className="tool-detail-desc" id="tool-detail-desc">
        {tool.description}
      </p>
      {/* Keyed by tool: a picker's own state (Show all, its filter) never carries to another. */}
      <ToolForm
        key={tool.name}
        tool={tool}
        draft={drafts[tool.name] ?? startDraft(tool)}
        setField={setField}
        invalid={problems?.tool === tool.name ? problems.fields : []}
        openPicker={openPicker}
        setOpenPicker={setOpenPicker}
        namesOf={key => namesOf(tool.name, key)}
        busy={busy}
        error={problems?.tool === tool.name ? problems.text : ''}
        onSubmit={submit}
      />
      {result?.tool === tool.name && (
        <div className={`tool-result ${result.ok ? 'ok' : 'err'}`} id="tool-result" role="status">
          <strong>{result.ok ? 'Result' : 'Error'}</strong>
          <pre>
            {typeof result.payload === 'string'
              ? result.payload
              : (JSON.stringify(result.payload, null, 2) ?? 'null')}
          </pre>
        </div>
      )}
    </div>
  ) : null;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="tools-drawer"
      onOpenAutoFocus={onOpenAutoFocus}
      title="🛠 Tool Runner"
      sub="Run any Foundry bridge tool"
      help="dashboard#the-tool-runner--tools"
      close={<DrawerClose id="drawer-close" data-track="dash.tools.close" />}
      onEscape={() => usage().track('shortcut', 'dash.shortcut.escape-tools')}
      onEscapeKey={escapeKey}
      bodyClassName="tool-runner-body"
    >
      {gmActionsOff && (
        <div className="gm-gate" id="gm-gate">
          <span>
            ⚠ GM Actions are <strong>off</strong>. Reads work; game-changing tools stay blocked
            until you enable them.
          </span>
          <button
            type="button"
            ref={gateButton}
            className="btn btn-primary"
            id="gm-gate-enable"
            data-track="dash.tools.enable-gm-actions"
            disabled={enabling}
            onClick={enableGmActions}
          >
            Enable GM Actions
          </button>
        </div>
      )}
      {detail ?? browser}
    </Drawer>
  );
}

/** The id of a field's control (its label points at it). */
const fieldId = (key: string): string => `tool-field-${key}`;

function ToolForm({
  tool,
  draft,
  setField,
  invalid,
  openPicker,
  setOpenPicker,
  namesOf,
  busy,
  error,
  onSubmit,
}: {
  tool: ToolInfo;
  draft: Draft;
  setField: (key: string, value: FieldValue) => void;
  invalid: string[];
  openPicker: string | null;
  setOpenPicker: (key: string | null) => void;
  namesOf: (key: string) => Map<string, string>;
  busy: boolean;
  error: string;
  onSubmit: () => void;
}): JSX.Element {
  const { props, required } = paramsOf(tool);
  const keys = Object.keys(props);
  const reads = tool.mutates === 'read' && !isPlanTool(tool.name);
  const text = (key: string): string => {
    const v = draft[key];
    return typeof v === 'string' ? v : '';
  };

  const field = (key: string): JSX.Element => {
    const def: ParamDef = props[key] ?? {};
    const id = fieldId(key);
    const isInvalid = invalid.includes(key);
    const hintId = def.description ? `${id}-desc` : undefined;
    const label = (
      <label htmlFor={id}>
        {key}
        {required.includes(key) && <span className="field-req">*</span>}
      </label>
    );
    const hint = def.description ? (
      <div className="field-hint" id={hintId}>
        {def.description}
      </div>
    ) : null;
    const common = {
      id,
      className: 'field-control',
      'aria-invalid': isInvalid || undefined,
      'aria-describedby': hintId,
    };

    if (Array.isArray(def.enum)) {
      return (
        <div className="field" key={key} data-key={key}>
          {label}
          <select {...common} value={text(key)} onChange={e => setField(key, e.target.value)}>
            {/* Not sent: the bridge's default applies (the old page's "choose" row). */}
            <option value="">(not set)</option>
            {def.enum.map(v => (
              <option key={String(v)} value={String(v)}>
                {String(v)}
              </option>
            ))}
          </select>
          {hint}
        </div>
      );
    }
    if (def.type === 'boolean') {
      return (
        <div className="field field-check" key={key} data-key={key}>
          <input
            {...common}
            className={undefined}
            type="checkbox"
            checked={draft[key] === true}
            onChange={e => setField(key, e.target.checked)}
          />
          {label}
          {hint}
        </div>
      );
    }
    const multiple = def.type === 'array';
    const control =
      multiple || def.type === 'object' ? (
        <textarea
          {...common}
          placeholder={multiple ? 'One value per line' : '{ } JSON'}
          value={text(key)}
          onChange={e => setField(key, e.target.value)}
        />
      ) : (
        <input
          {...common}
          // Text, not type=number: a browser number field reads "" for text that is not a
          // number, so an optional field would be dropped without a word. collectArgs checks it.
          type="text"
          inputMode={
            def.type === 'integer' ? 'numeric' : def.type === 'number' ? 'decimal' : undefined
          }
          value={text(key)}
          onChange={e => setField(key, e.target.value)}
        />
      );
    const ref = pickerRef(def);
    return (
      <div className="field" key={key} data-key={key}>
        {label}
        {ref ? (
          <RefPicker
            fieldId={id}
            refSpec={ref}
            multiple={multiple}
            value={text(key)}
            onChange={v => setField(key, v)}
            parentValue={ref.parent ? (fieldValues(text(ref.parent), true)[0] ?? '') : ''}
            open={openPicker === key}
            onOpenChange={o => setOpenPicker(o ? key : null)}
            names={namesOf(key)}
          >
            {control}
          </RefPicker>
        ) : (
          control
        )}
        {hint}
      </div>
    );
  };

  return (
    <form
      className="tool-form"
      id="tool-form"
      autoComplete="off"
      noValidate
      onSubmit={e => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {keys.map(field)}
      {keys.length === 0 && <p className="field-hint">This tool takes no parameters.</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" id="tool-run" disabled={busy}>
          {reads ? 'Run' : 'Run…'}
        </button>
        <span className="form-error" id="tool-form-error" role="alert">
          {error}
        </span>
      </div>
    </form>
  );
}
