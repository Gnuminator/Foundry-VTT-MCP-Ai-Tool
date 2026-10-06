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
 * - **Theme** (I-099): Neutral or The Veil for the whole vault, one theme per world shared with the
 *   dashboard (a pick here sets the dashboard's, and the dashboard's reaches Obsidian within 30
 *   seconds); Off turns the styling off in this Obsidian only. The CSS is the plugin's
 *   `styles.css` (built from `theme/obsidian-theme.css`); this file only sets classes.
 *
 * The GM token stays in Obsidian's secret storage; the plugin settings hold only its name.
 */
import {
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  SuggestModal,
  debounce,
  requestUrl,
  type App,
  type TFile,
} from 'obsidian';

import {
  DashboardClient,
  DashboardError,
  planLink,
  type GmChoice,
  type HttpClient,
  type RevealAction,
  type RevealState,
} from './dashboard.js';
import {
  libraryRootOf,
  mergeGraphColourGroups,
  ourGroups,
  type ColourGroup,
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
import { pickTheme, sameThemeState, syncTheme, type ThemeState } from './theme-sync.js';

/** The plugin settings, plus the theme state (I-099, theme-sync.ts). */
interface PluginSettings extends ThemeState {
  /** The co-GM dashboard, e.g. http://localhost:3000 (the bridge's FOUNDRY_AI_OPEN_BASE). */
  dashboardUrl: string;
  /** Name of the secret in Obsidian's secret storage that holds the GM token (may be empty). */
  tokenSecret: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
  dashboardUrl: 'http://localhost:3000',
  tokenSecret: '',
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
      () => this.token()
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
    const name = this.settings.tokenSecret.trim();
    if (!name) return null;
    return this.app.secretStorage.getSecret(name);
  }

  private noteFor(file: TFile | null): FoundryNote | null {
    if (!file || file.extension !== 'md') return null;
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
   * mirror's colour groups into the vault's graph.json, next to the GM's own groups. The mirror
   * itself never edits .obsidian; this runs only when the GM starts it.
   */
  async applyGraphColours(): Promise<void> {
    try {
      const { hubs, libraryRoots } = this.collectGraphSources();
      if (hubs.length === 0) {
        new Notice('No adventure hub notes yet. Let the mirror run a full update first.');
        return;
      }
      const adapter = this.app.vault.adapter;
      const path = `${this.app.vault.configDir}/graph.json`;
      let current: unknown = {};
      if (await adapter.exists(path)) {
        try {
          current = JSON.parse(await adapter.read(path)) as unknown;
        } catch {
          current = {};
        }
      }
      const { json, kept } = mergeGraphColourGroups(current, ourGroups(hubs, libraryRoots));
      await adapter.write(path, `${JSON.stringify(json, null, 2)}\n`);
      this.updateOpenGraphOptions(json.colorGroups as ColourGroup[]);
      const adventures = hubs.length === 1 ? '1 adventure' : `${hubs.length} adventures`;
      const own =
        kept === 0
          ? ''
          : kept === 1
            ? ' Your own colour group stays.'
            : ` Your ${kept} own colour groups stay.`;
      new Notice(
        `Graph colours set for ${adventures}, the Library in grey.${own} Close and reopen the graph view to see them.`
      );
    } catch (error) {
      new Notice(`Graph colours: ${messageOf(error)}`);
    }
  }

  /** Also tells Obsidian's own graph plugin, which would otherwise write its old options back. */
  private updateOpenGraphOptions(colorGroups: ColourGroup[]): void {
    try {
      // Internal API, may change: a failure here only means the GM reopens the graph view.
      const internal = (
        this.app as unknown as {
          internalPlugins?: {
            getPluginById?: (id: string) => {
              instance?: { options?: Record<string, unknown>; saveOptions?: () => unknown };
            } | null;
          };
        }
      ).internalPlugins;
      const instance = internal?.getPluginById?.('graph')?.instance;
      if (!instance?.options || typeof instance.options !== 'object') return;
      instance.options.colorGroups = colorGroups;
      if (typeof instance.saveOptions === 'function') void instance.saveOptions();
    } catch {
      // see above
    }
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
        "Only when the dashboard asks for a GM token (the player split is on). Pick or create a secret with the dashboard's GM token; it stays in Obsidian's secret storage, not in the plugin settings."
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
