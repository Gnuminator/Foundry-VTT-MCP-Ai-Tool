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
 * The GM token stays in Obsidian's secret storage; the plugin settings hold only its name.
 */
import {
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  SuggestModal,
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
  foundryNoteFrom,
  isJournalPage,
  revealStatus,
  statusText,
  type FoundryNote,
} from './note.js';

interface PluginSettings {
  /** The co-GM dashboard, e.g. http://localhost:3000 (the bridge's FOUNDRY_AI_OPEN_BASE). */
  dashboardUrl: string;
  /** Name of the secret in Obsidian's secret storage that holds the GM token (may be empty). */
  tokenSecret: string;
}

const DEFAULT_SETTINGS: PluginSettings = { dashboardUrl: 'http://localhost:3000', tokenSecret: '' };

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
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
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
    new Setting(containerEl)
      .setName('Dashboard address')
      .setDesc(
        'The co-GM dashboard, for example http://localhost:3000. The plugin talks only to it.'
      )
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
  }
}
