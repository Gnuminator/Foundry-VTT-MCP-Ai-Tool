/**
 * Practice room plan (idea 2.14): `plan-room-setup` with `action: practice` becomes one guarded
 * plan that makes a small generic training scene: a scene, a training dummy, one practice hero per
 * player (owned by that player), a step list as a journal entry and a begun combat of the heroes.
 * Nothing is written here; the backend stores the ops, `apply-planned-change` runs them and
 * `undo-change` deletes everything again. No book or campaign text: the names, numbers and step
 * texts are made up here.
 *
 * Ids are made now (`keepId`) so tokens, combatants and the journal can name each other in one
 * plan. Everything carries `flags.foundry-mcp-bridge.practice = true` so tools can tell it apart.
 * The wire contract is `shared/src/room-setup.ts` (types only are imported here).
 */
import type { GuardedOp, RoomPracticeRequest, RoomSetupPlan } from '@gnuminator/shared';

import { MODULE_ID } from './constants.js';
import { newId } from './new-id.js';

type Rec = Record<string, unknown>;

const OWNER_LEVEL = 3;
const OBSERVER_LEVEL = 2;
const MAX_PLAYERS = 8;
const GRID = 100;
const COLS = 14;
const ROWS = 10;

interface UserLike {
  id: string;
  name?: string;
  isGM?: boolean;
}

interface Globals {
  game: {
    users?: { contents?: UserLike[] };
    scenes?: { contents?: Array<{ name?: string }> };
  };
}

const globals = (): Globals => globalThis as unknown as Globals;

const PRACTICE_FLAGS = { [MODULE_ID]: { practice: true } };

const STEPS = {
  en: {
    journal: 'Practice room: how to',
    heading: 'Try the buttons before the real game',
    intro:
      'Nothing here counts. Your practice hero is yours alone; the dummy cannot hurt anyone. Take your time.',
    steps: [
      'Move: drag your hero token (or click it, then use the arrow keys) a few squares towards the dummy.',
      'Attack: open the hero sheet, press the Practice Sword on the Inventory tab and choose Attack, with the dummy targeted (select it, then press T).',
      'Cast: press the Practice Spark spell on the Spells tab and roll its attack the same way.',
      'End turn: when it is your turn in the combat tracker, press the arrow at the bottom (or the end turn button on your token) to pass it on.',
    ],
    outro: 'When you are done, tell the GM. They remove the whole room with one Undo.',
  },
  da: {
    journal: 'Øverum: sådan gør du',
    heading: 'Prøv knapperne før det rigtige spil',
    intro:
      'Intet her tæller. Din øvehelt er kun din; dukken kan ikke gøre nogen fortræd. Tag den med ro.',
    steps: [
      'Flyt: træk din helts token (eller klik på den og brug piletasterne) nogle felter hen mod dukken.',
      'Attack: åbn heltens ark, tryk på Practice Sword under Inventory og vælg Attack, med dukken som mål (vælg den, tryk så T).',
      'Cast: tryk på Practice Spark-besværgelsen under Spells og slå dens attack på samme måde.',
      'Afslut tur: når det er din tur i kampsporingen, tryk på pilen nederst (eller på knappen på din token) for at give den videre.',
    ],
    outro: 'Når du er færdig, så sig det til GM. Hele rummet fjernes med ét Undo.',
  },
} as const;

/** An attack activity with a single damage part (dnd5e 6 shape; see actor-builder for the original). */
function attackActivity(
  id: string,
  kind: { type: 'melee' | 'ranged'; classification: 'weapon' | 'spell' },
  damage: { number: number; denomination: number; type: string },
  range: Rec
): Rec {
  return {
    _id: id,
    type: 'attack',
    name: '',
    img: '',
    sort: 0,
    description: {},
    activation: { type: 'action', value: 1, condition: '', override: false },
    duration: { units: 'inst', value: '', override: false },
    target: {
      template: {
        count: '',
        contiguous: false,
        type: '',
        size: '',
        width: '',
        height: '',
        units: '',
      },
      affects: { count: '', type: '', choice: false, special: '' },
      prompt: true,
      override: false,
    },
    range: { ...range, override: false },
    uses: { spent: 0, max: '', recovery: [] },
    consumption: { targets: [], scaling: { allowed: false, max: '' }, spellSlot: false },
    attack: {
      ability: '',
      bonus: '',
      critical: { threshold: null },
      flat: false,
      type: kind,
    },
    damage: {
      critical: { bonus: '' },
      includeBase: false,
      parts: [
        {
          custom: { enabled: false, formula: '' },
          number: damage.number,
          denomination: damage.denomination,
          bonus: '',
          types: [damage.type],
          scaling: { mode: '', number: 1 },
        },
      ],
    },
    effects: [],
    save: { ability: '', dc: { formula: '', calculation: '' } },
  };
}

function practiceItems(): Rec[] {
  const swordActivity = newId();
  const sparkActivity = newId();
  return [
    {
      _id: newId(),
      name: 'Practice Sword',
      type: 'weapon',
      img: 'icons/svg/sword.svg',
      flags: PRACTICE_FLAGS,
      system: {
        description: { value: '<p>A blunt training sword.</p>' },
        quantity: 1,
        equipped: true,
        identified: true,
        type: { value: 'martialM', baseItem: '' },
        proficient: 1,
        range: { value: 5, units: 'ft' },
        damage: {
          base: {
            number: 1,
            denomination: 8,
            bonus: '',
            types: ['slashing'],
            custom: { enabled: false },
            scaling: { mode: '', number: 1 },
          },
        },
        activities: {
          [swordActivity]: attackActivity(
            swordActivity,
            { type: 'melee', classification: 'weapon' },
            { number: 1, denomination: 8, type: 'slashing' },
            { units: 'touch' }
          ),
        },
      },
    },
    {
      _id: newId(),
      name: 'Practice Spark',
      type: 'spell',
      img: 'icons/svg/lightning.svg',
      flags: PRACTICE_FLAGS,
      system: {
        description: { value: '<p>A harmless cantrip: a small bolt at something you can see.</p>' },
        level: 0,
        school: 'evo',
        properties: ['vocal', 'somatic'],
        activation: { type: 'action', value: 1, condition: '' },
        range: { value: 60, units: 'ft' },
        activities: {
          [sparkActivity]: attackActivity(
            sparkActivity,
            { type: 'ranged', classification: 'spell' },
            { number: 1, denomination: 8, type: 'lightning' },
            { value: '60', units: 'ft' }
          ),
        },
      },
    },
  ];
}

function tokenData(
  id: string,
  actorId: string,
  name: string,
  img: string,
  col: number,
  row: number,
  extra: Rec
): Rec {
  return {
    _id: id,
    actorId,
    name,
    x: col * GRID,
    y: row * GRID,
    width: 1,
    height: 1,
    texture: { src: img },
    actorLink: false,
    flags: PRACTICE_FLAGS,
    ...extra,
  };
}

function journalHtml(language: 'en' | 'da'): string {
  const t = STEPS[language];
  const list = t.steps.map(s => `<li>${s}</li>`).join('');
  return `<h2>${t.heading}</h2><p>${t.intro}</p><ol>${list}</ol><p>${t.outro}</p>`;
}

/** Build the practice room plan. Throws when the name is taken. */
export function planPracticeRoom(request: RoomPracticeRequest): RoomSetupPlan {
  const name = (request.name ?? '').trim() || 'Practice Room';
  const scenes = globals().game.scenes?.contents ?? [];
  if (scenes.some(s => String(s.name ?? '').toLowerCase() === name.toLowerCase())) {
    throw new Error(`A scene named "${name}" already exists: pick another name or remove it`);
  }
  const actors = (globals().game as { actors?: { contents?: Array<{ name?: string }> } }).actors;
  if ((actors?.contents ?? []).some(a => a.name === 'Training Dummy')) {
    throw new Error('A Training Dummy already exists: remove the old practice room first');
  }
  const users = (globals().game.users?.contents ?? []).filter(u => u.isGM !== true);
  const warnings: string[] = [];
  const players = users.slice(0, MAX_PLAYERS);
  if (users.length > MAX_PLAYERS) {
    warnings.push(
      `${users.length - MAX_PLAYERS} player(s) left out: a practice room holds ${MAX_PLAYERS}`
    );
  }

  const sceneId = newId();
  const combatId = newId();
  const dummyId = newId();
  const dummyTokenId = newId();
  const journalId = newId();

  const ops: GuardedOp[] = [];
  const tokens: NonNullable<RoomSetupPlan['tokens']> = [];

  ops.push({
    kind: 'create',
    documentName: 'Actor',
    keepId: true,
    data: {
      _id: dummyId,
      name: 'Training Dummy',
      type: 'npc',
      img: 'icons/svg/target.svg',
      flags: PRACTICE_FLAGS,
      ownership: { default: 0 },
      system: {
        attributes: { hp: { value: 40, max: 40 }, ac: { calc: 'flat', flat: 8 } },
      },
      prototypeToken: { name: 'Training Dummy', actorLink: false, disposition: -1 },
    },
  });

  // With no player users yet, one hero everyone may use keeps the room usable.
  const seats: Array<{ user: UserLike | null; label: string }> =
    players.length > 0
      ? players.map(u => ({ user: u, label: String(u.name ?? u.id) }))
      : [{ user: null, label: 'Everyone' }];
  const heroTokens: Array<{ tokenId: string; actorId: string }> = [];
  seats.forEach((seat, index) => {
    const actorId = newId();
    const tokenId = newId();
    ops.push({
      kind: 'create',
      documentName: 'Actor',
      keepId: true,
      data: {
        _id: actorId,
        name: `Practice Hero (${seat.label})`,
        type: 'character',
        img: 'icons/svg/mystery-man.svg',
        flags: PRACTICE_FLAGS,
        ownership: seat.user
          ? { default: 0, [seat.user.id]: OWNER_LEVEL }
          : { default: OWNER_LEVEL },
        system: {
          abilities: { str: { value: 14 }, dex: { value: 12 }, int: { value: 14 } },
          attributes: {
            hp: { value: 24, max: 24 },
            ac: { calc: 'flat', flat: 12 },
            spellcasting: 'int',
          },
        },
        prototypeToken: { actorLink: true, disposition: 1, name: `Practice Hero (${seat.label})` },
        items: practiceItems(),
      },
    });
    heroTokens.push({ tokenId, actorId });
    tokens.push({
      name: `Practice Hero (${seat.label})`,
      actorId,
      x: 1 + (index % 2),
      y: 2 + Math.floor(index / 2) * 2,
    });
  });

  const sceneTokens: Rec[] = heroTokens.map((h, index) =>
    tokenData(
      h.tokenId,
      h.actorId,
      tokens[index].name,
      'icons/svg/mystery-man.svg',
      tokens[index].x,
      tokens[index].y,
      { actorLink: true, disposition: 1 }
    )
  );
  sceneTokens.push(
    tokenData(dummyTokenId, dummyId, 'Training Dummy', 'icons/svg/target.svg', 10, 4, {
      disposition: -1,
    })
  );
  tokens.push({ name: 'Training Dummy', actorId: dummyId, x: 10, y: 4 });

  ops.push({
    kind: 'create',
    documentName: 'Scene',
    keepId: true,
    data: {
      _id: sceneId,
      name,
      active: false,
      navigation: false,
      flags: PRACTICE_FLAGS,
      width: COLS * GRID,
      height: ROWS * GRID,
      padding: 0,
      backgroundColor: '#2f3a33',
      grid: { type: 1, size: GRID, distance: 5, units: 'ft' },
      tokenVision: false,
      fog: { exploration: false },
      tokens: sceneTokens,
    },
  });

  ops.push({
    kind: 'create',
    documentName: 'JournalEntry',
    keepId: true,
    data: {
      _id: journalId,
      name: STEPS.en.journal,
      flags: PRACTICE_FLAGS,
      ownership: { default: OBSERVER_LEVEL },
      pages: (['en', 'da'] as const).map((language, sort) => ({
        _id: newId(),
        name: STEPS[language].journal,
        type: 'text',
        sort,
        text: { format: 1, content: journalHtml(language) },
      })),
    },
  });

  ops.push({
    kind: 'create',
    documentName: 'Combat',
    keepId: true,
    // Begun at round 1, turn 0, as plan-combat-change start does (a create op cannot call
    // Combat#startCombat). Initiative is set so nobody has to roll it.
    data: {
      _id: combatId,
      scene: sceneId,
      active: true,
      round: 1,
      turn: 0,
      flags: PRACTICE_FLAGS,
      combatants: heroTokens.map((h, index) => ({
        tokenId: h.tokenId,
        sceneId,
        actorId: h.actorId,
        initiative: 20 - index,
        hidden: false,
      })),
    },
  });

  warnings.push(
    'The scene is not activated: open it with switch-scene when the players are ready, and Undo removes the room, the practice actors and the combat. Once people have played in it (moved, rolled, ended turns) Undo refuses because the documents changed: then delete the scene, the Training Dummy, every Practice Hero actor and the journal entry by hand (all carry the practice flag).'
  );
  return {
    summary: `Set up the practice room "${name}" with ${heroTokens.length} practice hero${heroTokens.length === 1 ? '' : 'es'}, a training dummy and a begun combat`,
    ops,
    regions: [],
    tokens,
    warnings,
  };
}
