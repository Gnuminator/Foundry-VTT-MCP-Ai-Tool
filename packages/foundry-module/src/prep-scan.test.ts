/**
 * Unit tests for the session prep scan (I-045): quests, campaign parts, the
 * Next session journal and boss tokens.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CLOSED_QUEST_STATUSES,
  getPrepScan,
  htmlToText,
  NEXT_SESSION_JOURNAL_NAME,
  PREP_SCAN_QUERY,
} from './prep-scan.js';
import {
  CLOSED_QUEST_STATUSES as SHARED_CLOSED,
  NEXT_SESSION_JOURNAL_NAME as SHARED_NEXT,
  PREP_SCAN_QUERY as SHARED_QUERY,
} from '../../../shared/src/prep-digest.js';
import { createTestWorld, makeToken, type TestWorld } from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  world.addUser({ id: 'gm', name: 'Gamemaster', isGM: true });
  world.addUser({ id: 'p1', name: 'Player', isGM: false });
});

afterEach(() => {
  restore();
});

function page(content: string, name = 'Page'): Record<string, unknown> {
  return { type: 'text', name, text: { content } };
}

const questHtml = (status: string): string =>
  `<div><h3>Rewards &amp; Status</h3><ul><li><strong>Status:</strong> ${status}</li></ul></div>`;

const toggle = (campaignId: string, partId: string, cls = 'not-started'): string =>
  `<span class="campaign-status-toggle ${cls}" \n  data-campaign-id="${campaignId}" \n  data-part-id="${partId}"\n  title="Click">x</span>`;

describe('wire contract', () => {
  it('mirrors the shared constants', () => {
    expect(PREP_SCAN_QUERY).toBe(SHARED_QUERY);
    expect(NEXT_SESSION_JOURNAL_NAME).toBe(SHARED_NEXT);
    expect(CLOSED_QUEST_STATUSES).toEqual(SHARED_CLOSED);
  });
});

describe('quests', () => {
  it('lists an open and a closed quest with the status as written', () => {
    world.addJournal({ id: 'q1', name: 'Find the Amulet', pages: [page(questHtml('Active'))] });
    world.addJournal({ id: 'q2', name: 'Old Debt', pages: [page(questHtml(' Completed '))] });
    world.addJournal({ id: 'q3', name: 'Lost Cause', pages: [page(questHtml('FAILED'))] });
    const { quests } = getPrepScan();
    expect(quests).toEqual([
      { journalId: 'q1', name: 'Find the Amulet', status: 'Active', open: true },
      { journalId: 'q2', name: 'Old Debt', status: 'Completed', open: false },
      { journalId: 'q3', name: 'Lost Cause', status: 'FAILED', open: false },
    ]);
  });

  it('decodes entities and tolerates whitespace around the Status label', () => {
    world.addJournal({
      id: 'q',
      name: 'Odd',
      pages: [page('<li><strong> Status: </strong>\n  On hold &amp; waiting </li>')],
    });
    expect(getPrepScan().quests[0]).toMatchObject({ status: 'On hold & waiting', open: true });
  });

  it('ignores journals without a Status line and the Next session journal', () => {
    world.addJournal({ id: 'n', name: 'Plain notes', pages: [page('<p>Nothing here</p>')] });
    world.addJournal({ id: 'next', name: 'Next session', pages: [page(questHtml('Active'))] });
    expect(getPrepScan().quests).toEqual([]);
  });
});

describe('campaigns', () => {
  it('reads parts with the flag first, the class as fallback and the heading as title', () => {
    const html =
      `<div class="campaign-part"><h3>Part 1: Into the Mist</h3><p><strong>Status:</strong> ${toggle('c1', 'p1', 'not-started')}</p></div>` +
      `<div class="campaign-part"><h3>[LOCKED] Part 2: The Castle</h3><p><strong>Status:</strong> ${toggle('c1', 'p2', 'in-progress')}</p>` +
      `<div class="sub-parts"><h4>Sub-Parts:</h4><p><strong>2.1: Gate</strong> - Status: ${toggle('c1', 'p2a', 'skipped')}</p></div></div>` +
      `<div class="campaign-part"><p><strong>Status:</strong> ${toggle('c1', 'p3', 'completed')}</p></div>`;
    world.addJournal({
      id: 'dash',
      name: 'Campaign Dashboard',
      flags: { world: { campaignStatus: { 'c1-p1': 'completed', 'c1-p3': 'bogus' } } },
      pages: [page(html)],
    });
    const { campaigns, quests } = getPrepScan();
    expect(quests).toEqual([]);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({
      journalId: 'dash',
      name: 'Campaign Dashboard',
      campaignId: 'c1',
    });
    expect(campaigns[0]?.parts).toEqual([
      { partId: 'p1', title: 'Part 1: Into the Mist', status: 'completed' },
      { partId: 'p2', title: 'Part 2: The Castle', status: 'in_progress' },
      { partId: 'p2a', title: '2.1: Gate', status: 'skipped' },
      { partId: 'p3', title: 'p3', status: 'completed' },
    ]);
  });

  it('defaults to not_started without a flag or a known class', () => {
    world.addJournal({
      id: 'd',
      name: 'Dash',
      pages: [page(`<h3>Part A</h3>${toggle('c2', 'a', 'mystery')}`)],
    });
    expect(getPrepScan().campaigns[0]?.parts).toEqual([
      { partId: 'a', title: 'Part A', status: 'not_started' },
    ]);
  });
});

describe('next session', () => {
  it('is null when there is no such journal', () => {
    world.addJournal({ id: 'x', name: 'Something else', pages: [page('<p>hi</p>')] });
    expect(getPrepScan().nextSession).toBeNull();
  });

  it('returns each page as plain text, matched by name ignoring case and spaces', () => {
    world.addJournal({
      id: 'ns',
      name: '  NEXT Session ',
      ownership: { default: 0 },
      pages: [
        {
          id: 'pg1',
          ...page(
            '<h2>Plan</h2><p>Ireena &amp; Ismark&nbsp;arrive.</p><ul><li>Fight</li><li>Dinner</li></ul>',
            'Plan'
          ),
        },
        { id: 'pg2', type: 'image', name: 'Map' },
      ],
    });
    const next = getPrepScan().nextSession;
    expect(next).toMatchObject({ journalId: 'ns', playerVisible: false });
    expect(next?.pages).toEqual([
      {
        pageId: 'pg1',
        name: 'Plan',
        text: 'Plan Ireena & Ismark arrive. Fight Dinner',
        truncated: false,
      },
    ]);
  });

  it('truncates long pages at 2,000 characters', () => {
    world.addJournal({
      id: 'ns',
      name: 'Next session',
      ownership: { default: 0 },
      pages: [page(`<p>${'word '.repeat(1000)}</p>`)],
    });
    const p = getPrepScan().nextSession?.pages[0];
    expect(p?.truncated).toBe(true);
    expect(p?.text.length).toBeLessThanOrEqual(2000);
  });

  it('flags the journal as player visible when a player can observe it', () => {
    world.addJournal({
      id: 'ns',
      name: 'Next session',
      ownership: { default: 2 },
      pages: [page('<p>secret</p>')],
    });
    expect(getPrepScan().nextSession?.playerVisible).toBe(true);
  });
});

describe('bosses', () => {
  it('lists tokens whose actor has boss resources, hidden flag included', () => {
    world.addScene({
      id: 's1',
      name: 'Amber Temple',
      tokens: [
        makeToken({
          id: 't1',
          name: 'Aboleth 1',
          hidden: true,
          actor: {
            name: 'Aboleth',
            system: {
              resources: {
                legact: { max: 3, spent: 1, value: 2 },
                legres: { max: 3, spent: 0, value: 3 },
                lair: { value: true, inside: true, initiative: 20 },
              },
            },
          },
        }),
        makeToken({
          id: 't2',
          name: 'Wolf',
          actor: { name: 'Wolf', system: { resources: { legact: { max: 0 } } } },
        }),
        makeToken({ id: 't3', name: 'Actorless' }),
      ],
    });
    expect(getPrepScan().bosses).toEqual([
      {
        sceneId: 's1',
        sceneName: 'Amber Temple',
        tokenId: 't1',
        tokenName: 'Aboleth 1',
        actorName: 'Aboleth',
        hidden: true,
        legendary: { max: 3, spent: 1, remaining: 2 },
        resistances: { max: 3, spent: 0, remaining: 3 },
        lair: { inside: true, initiative: 20 },
      },
    ]);
  });
});

describe('getPrepScan', () => {
  it('is empty for a world with none of these and stamps the schema', () => {
    world.addJournal({ id: 'j', name: 'Random', pages: [page('<p>just text</p>')] });
    const scan = getPrepScan();
    expect(scan).toMatchObject({
      schema: 1,
      quests: [],
      campaigns: [],
      nextSession: null,
      bosses: [],
    });
    expect(typeof scan.computedAt).toBe('number');
  });
});

describe('htmlToText', () => {
  it('drops scripts and styles and collapses whitespace', () => {
    expect(
      htmlToText('<style>p{}</style><p>a</p>\n\n<p>b&lt;c&gt; &quot;d&quot; &#39;e&#39;</p>')
    ).toBe(`a b<c> "d" 'e'`);
  });
});
