/**
 * The reveal copy's proof (in the style of the M2 canary suites): a source page
 * in a GM-only journal holds unique canary strings in every form of secret
 * Foundry knows (and a few more), and none of them may reach anything the copy
 * flow writes or returns: the plans, every request sent to Foundry, the copy
 * page and the "Handouts" journal, the bridge vault on disk (reveals file and
 * audit log), `get-player-handouts` and `list-revealed-pages`. Covered for the
 * first copy, the update on a second reveal, the hide and its undo. As a
 * control, the source page still holds every canary (the seeding is real) and
 * the copy holds the visible text.
 *
 * The second suite covers what Foundry 14 pulls in when a player opens a page:
 * `@Embed` renders another document inline and a content link without a label
 * shows the target's name, both without a permission check on the player's
 * client. No reference to a GM document may reach the copy or the player view.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageForPlayers } from '@gnuminator/shared';

import { GuardedWriteService } from '../guarded-write/service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { HandoutsService } from './service.js';

const WORLD = 'curse-of-strahd';
const SOURCE = 'JournalEntry.cccccccccccccccc.JournalEntryPage.ssssssssssssssss';

/** Unique strings standing for GM secrets inside the source page; none may be copied. */
const CANARY = {
  section: 'CANARY-SECRET-SECTION',
  revealed: 'CANARY-REVEALED-SECRET',
  nested: 'CANARY-NESTED-SECRET',
  innerEnd: 'CANARY-AFTER-INNER-SECTION',
  wrapped: 'CANARY-SECRET-BLOCK-ELEMENT',
  gmOnly: 'CANARY-GM-ONLY-CLASS',
  classCase: 'CANARY-CLASS-UPPER-CASE',
  multiClass: 'CANARY-MULTI-CLASS',
  comment: 'CANARY-HTML-COMMENT',
  unclosed: 'CANARY-UNCLOSED-SECRET',
  secondReveal: 'CANARY-SECOND-REVEAL-SECRET',
} as const;

const VISIBLE = { opening: 'VISIBLE-OPENING-LINE', closing: 'VISIBLE-CLOSING-LINE' };

const SOURCE_HTML =
  `<p>${VISIBLE.opening}</p>` +
  `<section class="secret" id="secret-a"><p>${CANARY.section}</p></section>` +
  `<section class="secret revealed" id="secret-b"><p>${CANARY.revealed}</p></section>` +
  `<div><section class="secret"><h2>${CANARY.nested}</h2><ul><li>x</li></ul></section></div>` +
  `<section class="secret"><section><p>inner</p></section><p>${CANARY.innerEnd}</p></section>` +
  `<secret-block><section class="secret"><p>${CANARY.wrapped}</p></section></secret-block>` +
  `<p class="gm-only">${CANARY.gmOnly}</p>` +
  `<span class="SECRET">${CANARY.classCase}</span>` +
  `<p class="note secret">${CANARY.multiClass}</p>` +
  `<!-- ${CANARY.comment} -->` +
  `<p>${VISIBLE.closing}</p>` +
  `<section class="secret"><p>${CANARY.unclosed}`;

let dataDir: string;
let foundry: FakeFoundry;
let store: VaultStore;
let guarded: GuardedWriteService;
let handouts: HandoutsService;

function pageForPlayers(uuid: string): PageForPlayers {
  const doc = foundry.docs.get(uuid);
  if (!doc) {
    return {
      uuid,
      exists: false,
      name: null,
      observable: false,
      journalObservable: false,
      html: null,
    };
  }
  // The source's journal is GM-only; a copy inherits the "Handouts" journal (Observer).
  const journal = foundry.docs.get(uuid.split('.JournalEntryPage.')[0]);
  const journalObservable = (journal?.source.ownership?.default ?? 0) >= 2;
  return {
    uuid,
    exists: true,
    name: doc.source.name ?? null,
    observable: journalObservable,
    journalObservable,
    html: doc.source.text?.content ?? null,
    type: doc.source.type ?? 'text',
    src: null,
    caption: null,
  };
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'handouts-canary-'));
  foundry = new FakeFoundry();
  foundry.worldId = WORLD;
  foundry.features = [{ id: 'handouts', name: 'Handouts', hint: '', enabled: true }];
  foundry.handlers['foundry-mcp-bridge.getPagesForPlayers'] = (data: {
    uuids: string[];
  }): { pages: PageForPlayers[] } => ({ pages: data.uuids.map(pageForPlayers) });
  store = new VaultStore({ dataDir });
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const worldIds = { current: (): Promise<string> => Promise.resolve(WORLD) };
  guarded = new GuardedWriteService({
    foundryClient: foundry,
    worldIds,
    store,
    audit: new AuditLog(store),
    logger,
  });
  handouts = new HandoutsService({
    guardedWrites: guarded,
    store,
    worldIds,
    foundryClient: foundry,
  });
  foundry.add('JournalEntry.cccccccccccccccc', 'JournalEntry', {
    name: 'Chapter 4 (GM)',
    ownership: { default: 0 },
  });
  foundry.add(SOURCE, 'JournalEntryPage', {
    name: 'A Letter',
    type: 'text',
    text: { content: SOURCE_HTML, format: 1 },
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

/** Every file under the vault data dir, as text. */
async function vaultText(dir = dataDir): Promise<string> {
  let text = '';
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    text += entry.isDirectory() ? await vaultText(full) : await fsp.readFile(full, 'utf8');
  }
  return text;
}

/** Every fake Foundry document except the source page, as text. */
function foundryTextBesidesSource(): string {
  return JSON.stringify([...foundry.docs].filter(([uuid]) => uuid !== SOURCE));
}

function leaks(text: string): string[] {
  return Object.values(CANARY).filter(canary => text.includes(canary));
}

async function everythingWritten(plans: unknown[]): Promise<string> {
  return [
    JSON.stringify(plans),
    JSON.stringify(foundry.calls),
    foundryTextBesidesSource(),
    await vaultText(),
    JSON.stringify(await handouts.playerHandouts()),
    JSON.stringify(await handouts.listRevealed()),
    JSON.stringify(await guarded.listRecentChanges(50)),
  ].join('\n');
}

describe('reveal copy canary: secret blocks never leave the source page', () => {
  it('first copy, update, hide and undo carry none of the canaries', async () => {
    const plans: unknown[] = [];
    const reveal = await handouts.planPageReveal({ pageUuid: SOURCE, action: 'reveal' });
    plans.push(reveal);
    expect(reveal.copy?.action).toBe('create');
    expect(reveal.copy?.secretsRemoved).toBe(9);
    await guarded.applyPlan(reveal.planId, { confirm: true, confirmDestructive: true });
    const copyUuid = reveal.copy!.pageUuid;

    // Control: the copy holds the visible text, the source still holds every canary.
    const copyHtml = String(foundry.docs.get(copyUuid)?.source.text.content);
    expect(copyHtml).toContain(VISIBLE.opening);
    expect(copyHtml).toContain(VISIBLE.closing);
    expect(leaks(JSON.stringify(foundry.docs.get(SOURCE)))).toEqual(
      Object.values(CANARY).filter(c => c !== CANARY.secondReveal)
    );
    const firstScan = await everythingWritten(plans);
    expect(firstScan).toContain(VISIBLE.closing); // the scan does see the copied content
    expect(leaks(firstScan)).toEqual([]);

    // A second reveal after the GM added another secret: the update is clean too.
    foundry.edit(SOURCE, {
      path: 'text.content',
      present: true,
      value: `${SOURCE_HTML}</p></section><section class="secret"><p>${CANARY.secondReveal}</p></section><p>NEW-VISIBLE</p>`,
    });
    const update = await handouts.planPageReveal({ pageUuid: SOURCE, action: 'reveal' });
    plans.push(update);
    expect(update.copy?.action).toBe('update');
    await guarded.applyPlan(update.planId, { confirm: true, confirmDestructive: true });
    expect(String(foundry.docs.get(copyUuid)?.source.text.content)).toContain('NEW-VISIBLE');
    expect(leaks(await everythingWritten(plans))).toEqual([]);

    // Hide (deletes the copy; its source data goes to the audit log) and undo.
    const hide = await handouts.planPageReveal({ pageUuid: SOURCE, action: 'hide' });
    plans.push(hide);
    const hidden = await guarded.applyPlan(hide.planId, {
      confirm: true,
      confirmDestructive: true,
    });
    expect(foundry.docs.has(copyUuid)).toBe(false);
    await guarded.undo(hidden.changeId, { confirm: true });
    expect(foundry.docs.has(copyUuid)).toBe(true);
    expect(leaks(await everythingWritten(plans))).toEqual([]);

    // The source page and its journal were never written.
    const sourceJournal = SOURCE.split('.JournalEntryPage.')[0];
    const targets = foundry.calls
      .filter(([method]) => method === 'foundry-mcp-bridge.applyGuardedOps')
      .flatMap(([, request]) => request.ops as Array<Record<string, unknown>>)
      .map(op => (op.kind === 'create' ? (op.parentUuid ?? op.documentName) : op.uuid));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).not.toContain(SOURCE);
    expect(targets).not.toContain(sourceJournal);
  });
});

describe('reveal copy canary: enrichers never pull GM documents into the copy', () => {
  const GM_PAGE = 'JournalEntry.cccccccccccccccc.JournalEntryPage.gggggggggggggggg';
  const GM_ACTOR = 'Actor.hhhhhhhhhhhhhhhh';
  /** Anything that would let a player's client resolve a GM document from the copy. */
  const REFERENCES = [
    'gggggggggggggggg',
    'hhhhhhhhhhhhhhhh',
    '@Embed',
    '@embed',
    '@UUID',
    '@Actor',
  ];

  function referencesIn(text: string): string[] {
    return REFERENCES.filter(ref => text.includes(ref));
  }

  it('embeds and links to GM documents are gone from the copy, on the first copy and the update', async () => {
    foundry.add(GM_PAGE, 'JournalEntryPage', {
      name: 'CANARY-GM-PAGE-NAME',
      type: 'text',
      text: { content: '<p>CANARY-GM-PAGE-TEXT</p><section class="secret">CANARY-X</section>' },
    });
    foundry.add(GM_ACTOR, 'Actor', { name: 'CANARY-GM-ACTOR-NAME' });
    const html =
      `<p>${VISIBLE.opening}</p>` +
      `<p>@Embed[${GM_PAGE}]</p>` +
      `<p>@Embed[uuid=${GM_PAGE} secrets=true caption="Notes"]{Notes}</p>` +
      `<p>@embed[${GM_ACTOR} inline]</p>` +
      `<p>Meet @UUID[${GM_ACTOR}] at @UUID[${GM_PAGE}]{the tavern}. ` +
      '@Actor[hhhhhhhhhhhhhhhh] @UUID[.gggggggggggggggg]</p>' +
      `<p>${VISIBLE.closing}</p>`;
    foundry.edit(SOURCE, { path: 'text.content', present: true, value: html });

    const reveal = await handouts.planPageReveal({ pageUuid: SOURCE, action: 'reveal' });
    expect(reveal.copy).toMatchObject({ action: 'create', embedsRemoved: 3, linksUnlinked: 4 });
    await guarded.applyPlan(reveal.planId, { confirm: true, confirmDestructive: true });
    const copyUuid = reveal.copy!.pageUuid;

    const playerFacing = async (): Promise<string> =>
      JSON.stringify(foundry.docs.get(copyUuid)) + JSON.stringify(await handouts.playerHandouts());
    const copyHtml = String(foundry.docs.get(copyUuid)?.source.text.content);
    expect(copyHtml).toContain(VISIBLE.opening);
    expect(copyHtml).toContain('the tavern');
    expect(copyHtml).toContain(VISIBLE.closing);
    expect(referencesIn(await playerFacing())).toEqual([]);
    // Control: the source still holds every reference (the seeding is real).
    expect(referencesIn(JSON.stringify(foundry.docs.get(SOURCE)))).toEqual(REFERENCES);

    // The GM adds another embed; the update is clean too.
    foundry.edit(SOURCE, {
      path: 'text.content',
      present: true,
      value: `${html}<p>NEW-VISIBLE @Embed[${GM_ACTOR}]</p>`,
    });
    const update = await handouts.planPageReveal({ pageUuid: SOURCE, action: 'reveal' });
    expect(update.copy).toMatchObject({ action: 'update', embedsRemoved: 4 });
    await guarded.applyPlan(update.planId, { confirm: true, confirmDestructive: true });
    expect(String(foundry.docs.get(copyUuid)?.source.text.content)).toContain('NEW-VISIBLE');
    expect(referencesIn(await playerFacing())).toEqual([]);
    // The plan names the copy and the source, never a GM document it could resolve.
    expect(referencesIn(JSON.stringify(update))).toEqual([]);
  });
});
