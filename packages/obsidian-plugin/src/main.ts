/**
 * Foundry AI Tool companion plugin (idea I-059, OBSIDIAN-PLAN section 10 P1): desktop only, talks
 * only to the co-GM dashboard. For a note with `fvtt_uuid` (the Obsidian mirror writes it):
 *
 * - **Open in Foundry** (command, file menu, status bar click): `POST /api/open`, a GM picker when
 *   several GMs are logged in.
 * - **Reveal status** in the status bar for journal page notes, from `list-revealed-pages` (live,
 *   unlike the mirror's `revealed` frontmatter, which changes only on a mirror cycle).
 * - **Reveal / hide** make a `plan-page-reveal` plan and open the dashboard at `/?plan=<id>`, where
 *   the GM confirms it (D-067: Obsidian never applies a change itself). **Queue / unqueue** only
 *   stage the page in the GM's reveal queue; the reveal still happens in the dashboard.
 *
 * - **New prep note for this** (R2, D-094; command and file menu): a prep note in `Prep/` from the
 *   vault's template of the picked kind, with `fvtt_uuid` filled in and a link back (`prep.ts`).
 *   The only note the plugin writes, and only on the GM's click; it never needs the dashboard.
 *
 * - **Theme** (I-099): Neutral or The Veil for the whole vault, one theme per world shared with the
 *   dashboard (a pick here sets the dashboard's, and the dashboard's reaches Obsidian within 30
 *   seconds); Off turns the styling off in this Obsidian only. The CSS is the plugin's
 *   `styles.css` (built from `theme/obsidian-theme.css`); this file only sets classes.
 *
 * The GM token and the Cloudflare Access service token (for a dashboard behind Access, D-094 R1)
 * stay in Obsidian's secret storage, which is per device and never in the vault; the plugin
 * settings hold only the secrets' names.
 */
import {
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  SuggestModal,
  TFile,
  debounce,
  normalizePath,
  requestUrl,
  type TAbstractFile,
  type App,
  type ViewState,
  type WorkspaceLeaf,
} from 'obsidian';

import {
  DashboardClient,
  DashboardError,
  planLink,
  type AccessCredentials,
  type GmChoice,
  type HttpClient,
  type RevealAction,
  type RevealState,
} from './dashboard.js';
import {
  applyGraphColoursTo,
  graphColoursNotice,
  libraryRootOf,
  type GraphHost,
  type HubInfo,
} from './graph-colours.js';
import {
  foundryNoteFrom,
  isJournalPage,
  revealStatus,
  statusText,
  type FoundryNote,
} from './note.js';
import {
  BODY_CLASSES,
  NOTE_CLASS_PREFIX,
  THEMES,
  THEME_LABELS,
  barHeights,
  bodyClasses,
  isD20Header,
  isTheme,
  noteClasses,
  statCards,
  type ThemeId,
} from './theme.js';
import {
  campaignRootOf,
  fillPrepNote,
  findPrepNote,
  isPrepType,
  localDate,
  prepFileName,
  prepKindsFor,
  prepPathCandidates,
  prepUuid,
  type PrepKind,
} from './prep.js';
import { pickTheme, sameThemeState, syncTheme, type ThemeState } from './theme-sync.js';

/** The plugin settings, plus the theme state (I-099, theme-sync.ts). */
interface PluginSettings extends ThemeState {
  /** The co-GM dashboard, e.g. http://localhost:3000 (the bridge's FOUNDRY_AI_OPEN_BASE). */
  dashboardUrl: string;
  /** Name of the secret in Obsidian's secret storage that holds the GM token (may be empty). */
  tokenSecret: string;
  /** Names of the secrets that hold the Cloudflare Access service token (may be empty). */
  accessIdSecret: string;
  accessSecretSecret: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
  dashboardUrl: 'http://localhost:3000',
  tokenSecret: '',
  accessIdSecret: '',
  accessSecretSecret: '',
  theme: 'neutral',
  themeEnabled: true,
  pendingTheme: null,
};

/** Reveal state older than this is fetched again. */
const REVEAL_CACHE_MS = 20_000;
const STATUS_REFRESH_MS = 30_000;

const http: HttpClient = async request => {
  const headers = { ...request.headers };
  delete headers['Content-Type'];
  const response = await requestUrl({
    url: request.url,
    method: request.method,
    headers,
    contentType: 'application/json',
    ...(request.body !== undefined ? { body: request.body } : {}),
    throw: false,
  });
  let json: unknown = null;
  try {
    json = response.json as unknown;
  } catch {
    json = null;
  }
  return { status: response.status, json };
};

class GmPicker extends SuggestModal<GmChoice> {
  constructor(
    app: App,
    private readonly gms: GmChoice[],
    private readonly onPick: (gm: GmChoice) => void
  ) {
    super(app);
    this.setPlaceholder('Several GMs are logged in: whose Foundry screen?');
  }

  getSuggestions(query: string): GmChoice[] {
    const q = query.toLowerCase();
    return this.gms.filter(gm => gm.name.toLowerCase().includes(q));
  }

  renderSuggestion(gm: GmChoice, el: HTMLElement): void {
    el.setText(gm.name);
  }

  onChooseSuggestion(gm: GmChoice): void {
    this.onPick(gm);
  }
}

/** A mirror note "New prep note for this" works on (R2). */
interface PrepSource {
  file: TFile;
  note: FoundryNote;
  /** Its campaign folder, `Campaigns/<world>`. */
  root: string;
  /** The kinds to offer, the likely one first. */
  kinds: PrepKind[];
}

class PrepKindPicker extends SuggestModal<PrepKind> {
  constructor(
    app: App,
    private readonly kinds: PrepKind[],
    private readonly onPick: (kind: PrepKind) => void
  ) {
    super(app);
    this.setPlaceholder('New prep note: which kind?');
  }

  getSuggestions(query: string): PrepKind[] {
    const q = query.toLowerCase();
    return this.kinds.filter(kind => kind.label.toLowerCase().includes(q));
  }

  renderSuggestion(kind: PrepKind, el: HTMLElement): void {
    el.setText(kind.label);
  }

  onChooseSuggestion(kind: PrepKind): void {
    this.onPick(kind);
  }
}

export default class FoundryAiToolPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private client!: DashboardClient;
  private statusEl!: HTMLElement;
  private revealCache: { at: number; state: RevealState } | null = null;
  /** The documents that carry the theme classes: the main window's, plus any popouts. */
  private readonly docs = new Set<Document>([document]);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.client = new DashboardClient(
      http,
      () => this.settings.dashboardUrl,
      () => this.token(),
      () => this.access()
    );

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('foundry-ai-tool-status');
    this.statusEl.setAttribute('aria-label', 'Open in Foundry');
    this.registerDomEvent(this.statusEl, 'click', () => void this.openActive());

    this.addCommand({
      id: 'open-in-foundry',
      name: 'Open in Foundry',
      checkCallback: checking => this.withActiveNote(checking, note => void this.open(note)),
    });
    this.addRevealCommand(
      'reveal-to-players',
      'Reveal to players (confirm in the dashboard)',
      'reveal'
    );
    this.addRevealCommand(
      'hide-from-players',
      'Hide from players (confirm in the dashboard)',
      'hide'
    );
    this.addRevealCommand('queue-for-players', 'Add to the handout reveal queue', 'queue');
    this.addRevealCommand('unqueue-for-players', 'Remove from the handout reveal queue', 'unqueue');
    this.addCommand({
      id: 'refresh-status',
      name: 'Refresh Foundry status',
      callback: () => void this.refreshStatus(true),
    });

    this.addCommand({
      id: 'new-prep-note',
      name: 'New prep note for this',
      checkCallback: checking => {
        const source = this.prepSourceFor(this.app.workspace.getActiveFile());
        if (!source) return false;
        if (!checking) this.pickPrepKind(source);
        return true;
      },
    });

    this.addCommand({
      id: 'apply-graph-colours',
      name: 'Apply AI Tool graph colours',
      callback: () => void this.applyGraphColours(),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        const note = this.noteFor(file as TFile);
        if (!note) return;
        menu.addItem(item =>
          item
            .setTitle('Open in Foundry')
            .setIcon('external-link')
            .onClick(() => void this.open(note))
        );
        const source = this.prepSourceFor(file as TFile);
        if (source) {
          menu.addItem(item =>
            item
              .setTitle('New prep note for this')
              .setIcon('file-plus')
              .onClick(() => this.pickPrepKind(source))
          );
        }
      })
    );
    this.registerEvent(this.app.workspace.on('file-open', () => void this.refreshStatus(false)));
    this.registerEvent(
      this.app.metadataCache.on('changed', file => {
        if (file === this.app.workspace.getActiveFile()) void this.refreshStatus(false);
      })
    );
    this.registerInterval(
      window.setInterval(() => void this.refreshStatus(true), STATUS_REFRESH_MS)
    );
    this.addSettingTab(new FoundryAiToolSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => void this.refreshStatus(false));

    // The theme (I-099): classes on <body> and on each Markdown view; the CSS does the rest.
    this.applyTheme();
    const refreshNotes = debounce(() => this.refreshNoteClasses(), 150, true);
    this.registerEvent(this.app.workspace.on('layout-change', refreshNotes));
    this.registerEvent(this.app.workspace.on('file-open', refreshNotes));
    this.registerEvent(this.app.metadataCache.on('changed', refreshNotes));
    this.registerMarkdownPostProcessor(el => decorateNote(el));
    this.registerEvent(
      this.app.workspace.on('window-open', (_win, popout) => this.themeDocument(popout.document))
    );
    this.registerInterval(window.setInterval(() => void this.syncTheme(), STATUS_REFRESH_MS));
    this.app.workspace.onLayoutReady(() => {
      this.refreshNoteClasses();
      void this.syncTheme();
    });
  }

  onunload(): void {
    for (const doc of this.docs) doc.body?.classList.remove(...BODY_CLASSES);
    this.app.workspace.iterateAllLeaves(leaf => setNoteClasses(leaf.view.containerEl, []));
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
    if (!isTheme(this.settings.theme)) this.settings.theme = DEFAULT_SETTINGS.theme;
    // A pick the dashboard never took lasts only for the Obsidian session it was made in: after a
    // restart the GM may have changed the theme in the dashboard since, and that newer pick wins.
    this.settings.pendingTheme = null;
    this.settings.themeEnabled = this.settings.themeEnabled !== false;
  }

  /** The current choice as the settings dropdown shows it. */
  themeChoice(): ThemeId | 'off' {
    return this.settings.themeEnabled ? this.settings.theme : 'off';
  }

  /** Also style another window's document (popout windows, Obsidian's own settings window). */
  themeDocument(doc: Document): void {
    this.docs.add(doc);
    this.applyTheme();
  }

  private applyTheme(): void {
    const classes = bodyClasses(this.settings.theme, this.settings.themeEnabled);
    for (const doc of this.docs) {
      if (!doc.defaultView) {
        this.docs.delete(doc); // its window has closed
        continue;
      }
      doc.body.classList.remove(...BODY_CLASSES);
      doc.body.classList.add(...classes);
    }
  }

  private refreshNoteClasses(): void {
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const fm = view.file ? this.app.metadataCache.getFileCache(view.file)?.frontmatter : null;
      setNoteClasses(view.containerEl, noteClasses(fm));
    });
  }

  private themeState(): ThemeState {
    const { theme, themeEnabled, pendingTheme } = this.settings;
    return { theme, themeEnabled, pendingTheme };
  }

  private async useThemeState(state: ThemeState): Promise<void> {
    if (sameThemeState(state, this.themeState())) return;
    Object.assign(this.settings, state);
    this.applyTheme();
    await this.saveData(this.settings);
  }

  /** A pick in the settings (see theme-sync.ts); the look changes before the dashboard answers. */
  async pickTheme(choice: ThemeId | 'off'): Promise<void> {
    if (choice !== 'off') {
      this.settings.theme = choice;
      this.settings.themeEnabled = true;
    }
    this.applyTheme();
    const { state, notice } = await pickTheme(this.themeState(), choice, this.client);
    if (notice) new Notice(notice);
    await this.useThemeState(state);
    await this.saveData(this.settings);
  }

  /** Takes the dashboard's theme (or first sends one picked here while it was offline). */
  async syncTheme(): Promise<void> {
    await this.useThemeState(await syncTheme(this.themeState(), this.client));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.revealCache = null;
    void this.refreshStatus(true);
  }

  private token(): string | null {
    return this.secret(this.settings.tokenSecret);
  }

  private secret(name: string): string | null {
    const key = name.trim();
    return key ? this.app.secretStorage.getSecret(key) : null;
  }

  private access(): AccessCredentials | null {
    const clientId = this.secret(this.settings.accessIdSecret)?.trim();
    const clientSecret = this.secret(this.settings.accessSecretSecret)?.trim();
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  private noteFor(file: TFile | null): FoundryNote | null {
    if (file?.extension !== 'md') return null;
    return foundryNoteFrom(this.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  private activeNote(): FoundryNote | null {
    return this.noteFor(this.app.workspace.getActiveFile());
  }

  /** A command's checkCallback: available only on a note that points at Foundry. */
  private withActiveNote(
    checking: boolean,
    run: (note: FoundryNote) => void,
    pageOnly = false
  ): boolean {
    const note = this.activeNote();
    if (!note || (pageOnly && !isJournalPage(note))) return false;
    if (!checking) run(note);
    return true;
  }

  private addRevealCommand(id: string, name: string, action: RevealAction): void {
    this.addCommand({
      id,
      name,
      checkCallback: checking =>
        this.withActiveNote(checking, note => void this.reveal(note, action), true),
    });
  }

  /** A mirror note that can get a prep note: a world document (not a compendium entry or a prep
   * note itself) in its world's campaign folder. */
  private prepSourceFor(file: TFile | null): PrepSource | null {
    const note = this.noteFor(file);
    if (!file || !note || note.uuid.startsWith('Compendium.')) return null;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    if (isPrepType(frontmatter?.type)) return null;
    const root = campaignRootOf(file.path, note.world);
    if (!root) return null;
    const type = typeof frontmatter?.type === 'string' ? frontmatter.type : null;
    return { file, note, root, kinds: prepKindsFor(type, note.type) };
  }

  private pickPrepKind(source: PrepSource): void {
    new PrepKindPicker(this.app, source.kinds, kind => void this.newPrepNote(source, kind)).open();
  }

  /** A vault file or folder at this path in any letter case (NTFS and APFS ignore case, so
   * `Prep/npcs` is the same folder as `Prep/NPCs` there). */
  private findIgnoringCase(path: string): TAbstractFile | null {
    const { vault } = this.app;
    const exact = vault.getAbstractFileByPath(path);
    if (exact) return exact;
    const lower = path.toLowerCase();
    return vault.getAllLoadedFiles().find(f => f.path.toLowerCase() === lower) ?? null;
  }

  /** Make (or open, when it is already there) the prep note of this kind for a mirror note. */
  private async newPrepNote(source: PrepSource, kind: PrepKind): Promise<void> {
    const { vault, fileManager, metadataCache, workspace } = this.app;
    try {
      const uuid = prepUuid(kind, source.note.uuid);
      const today = localDate(new Date());
      // A session plan is one per game night, so it never reuses an older plan.
      const isPlan = kind.id === 'session';
      if (!isPlan) {
        const found = findPrepNote(
          vault.getMarkdownFiles().map(f => ({
            path: f.path,
            frontmatter: metadataCache.getFileCache(f)?.frontmatter,
          })),
          source.root,
          uuid,
          kind.type
        );
        const existing = found ? vault.getAbstractFileByPath(found) : null;
        if (existing instanceof TFile) {
          await workspace.getLeaf(false).openFile(existing);
          new Notice(
            `${kind.label} for ${source.note.name ?? existing.basename} is already there: opened ${existing.path}.`
          );
          return;
        }
      }
      const wanted = normalizePath(`${source.root}/Prep/${kind.folder}`);
      const folder = this.findIgnoringCase(wanted)?.path ?? wanted;
      const name = isPlan
        ? `Session ${today}`
        : prepFileName(source.note.name ?? source.file.basename);
      let target: string | null = null;
      for (const candidate of prepPathCandidates(folder, name)) {
        const path = normalizePath(candidate);
        if (!this.findIgnoringCase(path) && !(await vault.adapter.exists(path))) {
          target = path;
          break;
        }
      }
      if (!target) {
        new Notice(`${kind.label}: ${folder} already has too many notes called ${name}.`);
        return;
      }
      if (!this.findIgnoringCase(folder)) await vault.createFolder(folder);
      const templateFile = this.findIgnoringCase(
        normalizePath(`${source.root}/Prep/Templates/${kind.template}`)
      );
      const template = templateFile instanceof TFile ? await vault.cachedRead(templateFile) : null;
      const link = fileManager.generateMarkdownLink(source.file, target);
      const created = await vault.create(
        target,
        fillPrepNote(template, {
          type: kind.type,
          uuid,
          link,
          ...(isPlan ? { date: today } : {}),
        })
      );
      await workspace.getLeaf(false).openFile(created);
      new Notice(
        (template === null
          ? `Made ${target} (no ${kind.template} template in Prep/Templates, so a bare one).`
          : `Made ${target}.`) +
          (isPlan
            ? ` Its date is today (${today}); change it when the game night is another day.`
            : '')
      );
    } catch (error) {
      new Notice(`New prep note: ${messageOf(error)}`);
    }
  }

  private async openActive(): Promise<void> {
    const note = this.activeNote();
    if (note) await this.open(note);
  }

  private async open(note: FoundryNote, userId?: string): Promise<void> {
    try {
      const outcome = await this.client.openInFoundry(note.uuid, userId);
      if (outcome.kind === 'opened') {
        new Notice(`Opened ${outcome.name ?? note.name ?? 'the document'} in Foundry.`);
      } else if (outcome.kind === 'choose-gm') {
        new GmPicker(this.app, outcome.gms, gm => void this.open(note, gm.id)).open();
      } else {
        new Notice(`Open in Foundry: ${outcome.message}`);
      }
    } catch (error) {
      new Notice(`Open in Foundry: ${messageOf(error)}`);
    }
  }

  private async reveal(note: FoundryNote, action: RevealAction): Promise<void> {
    try {
      const { planId, note: text } = await this.client.planReveal(note.uuid, action);
      if (planId) {
        const link = planLink(this.settings.dashboardUrl, planId);
        if (link) window.open(link);
        new Notice('Plan made. Confirm it in the dashboard (it opened in your browser).');
      } else if (action === 'queue') {
        // The tool's own note speaks to Claude ("reveal-next"); the GM reveals from the dashboard.
        new Notice(
          `Queued ${note.name ?? 'the page'} for players. Reveal it from the dashboard's handout drawer (Reveal next) when the moment comes.`
        );
      } else if (action === 'unqueue') {
        new Notice(`Removed ${note.name ?? 'the page'} from the handout reveal queue.`);
      } else {
        new Notice(text || 'Done.');
      }
    } catch (error) {
      new Notice(`Players: ${messageOf(error)}`);
    }
    this.revealCache = null;
    await this.refreshStatus(true);
  }

  /** The adventure hub notes of the mirror and the campaign roots that have a Library. */
  private collectGraphSources(): { hubs: HubInfo[]; libraryRoots: string[] } {
    const hubs: HubInfo[] = [];
    const libraryRoots = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (!fm) continue;
      if (fm.type === 'adventure-hub' && fm.generated_by === 'foundry-ai-tool') {
        const raw = fm.adventure_folders;
        const folders = Array.isArray(raw)
          ? raw.filter((folder): folder is string => typeof folder === 'string')
          : [];
        hubs.push({ path: file.path, folders });
      } else if (fm.type === 'library-book') {
        const root = libraryRootOf(file.path);
        if (root !== null) libraryRoots.add(root);
      }
    }
    return { hubs, libraryRoots: [...libraryRoots] };
  }

  /**
   * Colours each adventure's notes in the graph view and the Library grey (I-105): merges the
   * mirror's colour groups into the graph options, next to the GM's own groups. The mirror
   * itself never edits .obsidian; this runs only when the GM starts it.
   */
  async applyGraphColours(): Promise<void> {
    try {
      const { hubs, libraryRoots } = this.collectGraphSources();
      if (hubs.length === 0) {
        new Notice('No adventure hub notes yet. Let the mirror run a full update first.');
        return;
      }
      const result = await applyGraphColoursTo(this.graphHost(), hubs, libraryRoots);
      new Notice(graphColoursNotice(result));
    } catch (error) {
      new Notice(`Graph colours: ${messageOf(error)}`);
    }
  }

  /** Obsidian's side of the graph colours: the graph views, the graph plugin and graph.json. */
  private graphHost(): GraphHost {
    const app = this.app;
    const adapter = app.vault.adapter;
    const file = `${app.vault.configDir}/graph.json`;
    const instance = (): GraphPluginInstance | null => {
      try {
        // Internal API, may change: without it the colours go to graph.json only.
        const internal = (app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
        const found = internal?.getPluginById?.('graph')?.instance;
        return found?.options && typeof found.options === 'object' ? found : null;
      } catch {
        return null;
      }
    };
    const wait = (ms: number): Promise<void> =>
      new Promise(resolve => window.setTimeout(resolve, ms));
    const parked: Array<{ leaf: WorkspaceLeaf; state: ViewState }> = [];
    return {
      parkGraphViews: async (): Promise<number> => {
        parked.length = 0;
        for (const leaf of app.workspace.getLeavesOfType('graph')) {
          parked.push({ leaf, state: leaf.getViewState() });
          // An empty view in the same leaf: the graph view closes (and stores its options)
          // while the leaf keeps its place, pin and group.
          await leaf.setViewState({ type: 'empty' });
        }
        // A view stores its options while it closes; give that a moment before they are read.
        if (parked.length > 0) await wait(100);
        return parked.length;
      },
      restoreGraphViews: async (): Promise<number> => {
        let restored = 0;
        for (const { leaf, state } of parked.splice(0)) {
          try {
            await leaf.setViewState(state);
            restored += 1;
          } catch {
            // The leaf was closed meanwhile: nothing to put back.
          }
        }
        return restored;
      },
      graphOptions: (): Record<string, unknown> | null => {
        const options = instance()?.options;
        return options ? { ...options } : null;
      },
      setGraphOptions: async (options): Promise<boolean> => {
        try {
          const found = instance();
          if (!found?.options) return false;
          // Set even when it cannot save, or the live options would write the old groups back.
          found.options.colorGroups = options.colorGroups;
          if (typeof found.saveOptions !== 'function') return false;
          await found.saveOptions();
          return true;
        } catch {
          return false;
        }
      },
      readGraphJson: async (): Promise<unknown> => {
        if (!(await adapter.exists(file))) return {};
        try {
          return JSON.parse(await adapter.read(file)) as unknown;
        } catch {
          return {};
        }
      },
      writeGraphJson: json => adapter.write(file, `${JSON.stringify(json, null, 2)}\n`),
      wait,
    };
  }

  private async revealState(force: boolean): Promise<RevealState> {
    const now = Date.now();
    if (!force && this.revealCache && now - this.revealCache.at < REVEAL_CACHE_MS) {
      return this.revealCache.state;
    }
    const state = await this.client.revealState();
    this.revealCache = { at: now, state };
    return state;
  }

  private async refreshStatus(force: boolean): Promise<void> {
    const note = this.activeNote();
    if (!note) {
      this.statusEl.setText('');
      this.statusEl.hide();
      return;
    }
    this.statusEl.show();
    if (!isJournalPage(note)) {
      this.statusEl.removeClass('is-offline');
      this.statusEl.setText(statusText(note, null));
      return;
    }
    try {
      const status = revealStatus(note, await this.revealState(force));
      if (this.activeNote()?.uuid !== note.uuid) return;
      this.statusEl.removeClass('is-offline');
      this.statusEl.setText(statusText(note, status));
    } catch (error) {
      this.statusEl.addClass('is-offline');
      this.statusEl.setText(statusText(note, 'offline'));
      this.statusEl.setAttribute('aria-label', messageOf(error));
    }
  }
}

/** Replaces the plugin's note classes on a view's container. */
function setNoteClasses(el: HTMLElement, classes: string[]): void {
  const old = Array.from(el.classList).filter(c => c.startsWith(NOTE_CLASS_PREFIX));
  if (old.length === classes.length && old.every(c => classes.includes(c))) return;
  el.classList.remove(...old);
  el.classList.add(...classes);
}

/**
 * Reading view extras for the theme: the d20 spread as bars (with the counts) in place of its
 * table, and the session stats line as small cards. The original stays in the page; the CSS shows one or the other, so
 * turning the theme off needs no re-render.
 */
function decorateNote(el: HTMLElement): void {
  for (const table of Array.from(el.querySelectorAll('table'))) {
    const head = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent ?? '');
    if (!isD20Header(head)) continue;
    const row = table.querySelector('tbody tr');
    if (!row) continue;
    const counts = Array.from(row.querySelectorAll('td')).map(td => Number(td.textContent));
    const bars = createDiv({ cls: 'aitool-d20' });
    barHeights(counts).forEach((h, i) => {
      const bar = bars.createDiv({ cls: 'aitool-d20-bar' });
      bar.style.setProperty('--aitool-h', h.toFixed(3));
      bar.setAttribute('aria-label', `${i + 1}: ${counts[i] ?? 0}`);
      bar.createSpan({ cls: 'aitool-d20-c', text: String(counts[i] ?? 0) });
      bar.createSpan({ cls: 'aitool-d20-n', text: String(i + 1) });
    });
    table.classList.add('aitool-d20-table');
    table.before(bars);
  }
  for (const p of Array.from(el.querySelectorAll('p'))) {
    const cards = statCards(p.textContent ?? '');
    if (!cards) continue;
    const box = createDiv({ cls: 'aitool-stat-cards' });
    for (const card of cards) {
      const c = box.createDiv({ cls: 'aitool-stat-card' });
      c.createSpan({ text: card.label });
      c.createEl('b', { text: card.value });
    }
    p.classList.add('aitool-stat-line');
    p.after(box);
  }
}

/** The graph core plugin's instance, as far as the colours need it (internal API). */
interface GraphPluginInstance {
  options?: Record<string, unknown>;
  saveOptions?: () => unknown;
}

interface InternalPlugins {
  getPluginById?: (id: string) => { instance?: GraphPluginInstance } | null;
}

function messageOf(error: unknown): string {
  if (error instanceof DashboardError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

class FoundryAiToolSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: FoundryAiToolPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.plugin.themeDocument(containerEl.ownerDocument);
    new Setting(containerEl)
      .setName('Dashboard address')
      .setDesc('The dashboard, for example http://localhost:3000. The plugin talks only to it.')
      .addText(text =>
        text
          .setPlaceholder('http://localhost:3000')
          .setValue(this.plugin.settings.dashboardUrl)
          .onChange(async value => {
            this.plugin.settings.dashboardUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName('GM token')
      .setDesc(
        "Only when the dashboard asks for a GM token (the player split is on, as on the Pi). Pick or create a secret with the dashboard's GM token; it stays in Obsidian's secret storage, not in the plugin settings."
      )
      .addComponent(el =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.tokenSecret)
          .onChange(async value => {
            this.plugin.settings.tokenSecret = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName('Cloudflare Access Client ID')
      .setDesc(
        "Only when the dashboard is behind Cloudflare Access (an https address). Pick or create a secret with the service token's Client ID. Sent only to https addresses."
      )
      .addComponent(el =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.accessIdSecret)
          .onChange(async value => {
            this.plugin.settings.accessIdSecret = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName('Cloudflare Access Client Secret')
      .setDesc(
        "The same service token's Client Secret, in a secret of its own. Both stay in Obsidian's secret storage on this PC, never in the vault."
      )
      .addComponent(el =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.accessSecretSecret)
          .onChange(async value => {
            this.plugin.settings.accessSecretSecret = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName('Theme')
      .setDesc(
        "The look of the whole vault, one theme per world: picking Neutral or The Veil here also changes the dashboard's theme, and a pick in the dashboard reaches Obsidian. Off turns the styling off in this Obsidian only."
      )
      .addDropdown(dropdown => {
        for (const theme of THEMES) dropdown.addOption(theme, THEME_LABELS[theme]);
        // Later updates set the <select> directly: calling dropdown.setValue() again here sent
        // Obsidian 1.13's settings window into a loop that froze the vault window (I-099).
        const show = (): void => {
          dropdown.selectEl.value = this.plugin.themeChoice();
        };
        dropdown
          .addOption('off', 'Off')
          .setValue(this.plugin.themeChoice())
          .onChange(async value => {
            await this.plugin.pickTheme(isTheme(value) ? value : 'off');
            show();
          });
        void this.plugin.syncTheme().then(show);
      });
    new Setting(containerEl)
      .setName('Graph colours')
      .setDesc(
        "Colours each adventure's notes in the graph view and the Library grey. Your own colour groups stay."
      )
      .addButton(button =>
        button.setButtonText('Apply AI Tool graph colours').onClick(() => {
          void this.plugin.applyGraphColours();
        })
      );
  }
}
