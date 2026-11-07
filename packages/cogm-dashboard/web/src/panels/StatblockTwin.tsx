// The 2024 twin of a monster (read only): pick a 2014 monster (a world actor or a compendium
// entry), and the 2024 SRD stat block of the same monster shows beside it. The GM decides which one
// to run; a monster with no clear twin says so. Nothing is converted and nothing is written. The
// matching rule and the reviewed table are in lib/statblockTwin.ts. GM only.
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { RefPicker } from '../components/RefPicker';
import { callTool, errorText } from '../lib/api';
import {
  TWIN_PACK,
  decideTwin,
  formatCr,
  parseMonsterUuid,
  statBlockFromActor,
  statBlockFromCompendium,
  twinSearchName,
  type StatBlock,
  type TwinVerdict,
} from '../lib/statblockTwin';
import type { ToolRef } from '../lib/toolForm';
import { Button, Card } from '../ui';

import styles from './StatblockTwin.module.css';

/**
 * Two pickers: the world's actors and tokens (listed at once), and the compendiums (a list that
 * needs a few typed letters, so it cannot share a picker with the first). The value is the uuid.
 */
const WORLD_REF: ToolRef = { kind: ['actor', 'token'], value: 'uuid' };
const PACK_REF: ToolRef = {
  kind: 'compendium-entry',
  value: 'uuid',
  filter: { documentName: 'Actor' },
};

interface Found {
  /** The monster as picked (the 2014 side). */
  left: { uuid: string; block: StatBlock };
  verdict: TwinVerdict;
  /** The 2024 side, when there is a clear twin. */
  right: { uuid: string; block: StatBlock } | null;
}

/** list-ref-choices for one pack: the entries whose name contains the query. */
interface PackList {
  choices?: { id?: string; name?: string }[];
  truncated?: boolean;
  note?: string;
}

/** A token stands in with its base actor (an unlinked token differs from it only in deltas). */
async function actorIdOfToken(tokenId: string): Promise<string> {
  const token = await callTool<{ actor?: { id?: string } }>('get-token-details', { tokenId });
  const id = token?.actor?.id;
  if (!id) throw new Error('This token has no actor to show.');
  return id;
}

async function lookup(uuid: string): Promise<Found | 'not-a-monster'> {
  const ref = parseMonsterUuid(uuid);
  if (!ref) return 'not-a-monster';
  const block =
    ref.kind === 'compendium'
      ? statBlockFromCompendium(
          await callTool('get-compendium-item', { packId: ref.pack, itemId: ref.id })
        )
      : statBlockFromActor(
          await callTool('get-character', {
            identifier: ref.kind === 'token' ? await actorIdOfToken(ref.id) : ref.id,
          })
        );
  if (!block) throw new Error('This monster has no stat block to show.');
  const left = { uuid, block };
  // Only the 2024 pack is surely 2024: an entry's own rules field defaults to the world setting
  // when the data never stored it, so it cannot hide the twin search.
  if (ref.kind === 'compendium' && ref.pack === TWIN_PACK) {
    return { left, verdict: { kind: 'already-2024' }, right: null };
  }
  // The search is scoped to the 2024 pack, so a common name cannot push the real hit out of a
  // shared cap; a list that still came back cut short is "unsure", never "no twin".
  const wanted = twinSearchName(block.name);
  const found = await callTool<PackList>('list-ref-choices', {
    kind: 'compendium-entry',
    parent: TWIN_PACK,
    filter: { documentName: 'Actor' },
    query: wanted,
    limit: 200,
  });
  const inPack = (found.choices ?? []).filter(r => r.id && r.name);
  if (inPack.length === 0 && found.note) {
    // A missing or unreadable pack is not "no twin".
    return {
      left,
      verdict: {
        kind: 'unsure',
        reason: 'The 2024 monsters could not be read in this world, so this could not be checked.',
      },
      right: null,
    };
  }
  const verdict = decideTwin(
    block.name,
    inPack.map(r => r.name ?? ''),
    undefined,
    found.truncated === true
  );
  if (verdict.kind !== 'twin') return { left, verdict, right: null };
  const hit = inPack.find(r => r.name === verdict.name);
  if (!hit?.id)
    return {
      left,
      verdict: { kind: 'none', reason: 'The 2024 entry could not be found.' },
      right: null,
    };
  const twin = statBlockFromCompendium(
    await callTool('get-compendium-item', { packId: TWIN_PACK, itemId: hit.id })
  );
  if (!twin)
    return {
      left,
      verdict: { kind: 'none', reason: 'The 2024 entry has no stat block.' },
      right: null,
    };
  return { left, verdict, right: { uuid: `Compendium.${TWIN_PACK}.Actor.${hit.id}`, block: twin } };
}

function Column({
  title,
  uuid,
  block,
}: {
  title: string;
  uuid: string;
  block: StatBlock;
}): JSX.Element {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <Card className={styles['col']} data-testid="twin-column">
      <h3 className={styles['colTitle']}>{title}</h3>
      <h4 className={styles['name']}>{block.name}</h4>
      <p className={styles['sub']}>{[block.size, block.creatureType].filter(Boolean).join(' ')}</p>
      <dl className={styles['numbers']}>
        <div>
          <dt>CR</dt>
          <dd>{formatCr(block.cr)}</dd>
        </div>
        <div>
          <dt>AC</dt>
          <dd>{block.ac ?? 'see sheet'}</dd>
        </div>
        <div>
          <dt>HP</dt>
          <dd>{block.hp ?? '?'}</dd>
        </div>
        {block.abilities.map(a => (
          <div key={a.key}>
            <dt>{a.key}</dt>
            <dd>{a.value}</dd>
          </div>
        ))}
      </dl>
      {block.speed && <p className={styles['sub']}>Speed {block.speed}</p>}
      <ul className={styles['features']}>
        {block.features.map((f, i) => (
          <li key={`${f}-${i}`}>{f}</li>
        ))}
      </ul>
      <Button
        size="sm"
        data-track="dash.twin.open"
        onClick={() => {
          setOpened(null);
          callTool('open-in-foundry', { uuid }).then(
            () => setOpened('Opened on your Foundry screen.'),
            (err: unknown) => setOpened(errorText(err))
          );
        }}
      >
        Open in Foundry to read it and run it
      </Button>
      {opened && (
        <p className={styles['sub']} role="status">
          {opened}
        </p>
      )}
    </Card>
  );
}

/** Same numbers and the same feature list: probably the 2024 entry itself, copied into a world. */
function sameAsTwin(a: StatBlock, b: StatBlock): boolean {
  return (
    a.cr === b.cr && a.ac === b.ac && a.hp === b.hp && a.features.join('|') === b.features.join('|')
  );
}

function Result({ found }: { found: Found }): JSX.Element {
  const { left, verdict, right } = found;
  return (
    <>
      {verdict.kind === 'none' && (
        <div className="preflight-summary pf-warn" id="twin-none">
          <strong>No clear 2024 twin.</strong> {verdict.reason}
          {verdict.closest && (
            <>
              {' '}
              The nearest 2024 monster is the {verdict.closest}; it is a different monster, not a
              twin.
            </>
          )}
        </div>
      )}
      {verdict.kind === 'unsure' && (
        <div className="preflight-summary pf-warn" id="twin-unsure">
          <strong>Could not check for a 2024 twin.</strong> {verdict.reason}
        </div>
      )}
      {verdict.kind === 'already-2024' && (
        <div className="preflight-summary" id="twin-already">
          This is already a 2024 monster. Pick the 2014 one to see its twin.
        </div>
      )}
      {verdict.kind === 'twin' && right && (
        <p className={`pf-detail ${styles['note']}`} id="twin-found">
          {sameAsTwin(left.block, right.block)
            ? 'The monster you picked may already be the 2024 version. '
            : `Same monster, 2024 text. The older CR balances the book's encounters${
                left.block.cr !== right.block.cr
                  ? `; the 2024 one is CR ${formatCr(right.block.cr)} against ${formatCr(left.block.cr)}`
                  : ''
              }. `}
          You choose which one to run. A compendium monster opens locked: import it to a scene to
          run it.
        </p>
      )}
      <div className={styles['columns']}>
        <Column title="As picked" uuid={left.uuid} block={left.block} />
        {right && <Column title="2024 SRD twin" uuid={right.uuid} block={right.block} />}
      </div>
    </>
  );
}

export function StatblockTwinDrawer({
  open,
  onOpenChange,
  initialUuid = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A monster to start on (the stories use it). */
  initialUuid?: string;
}): JSX.Element {
  const startsInWorld = parseMonsterUuid(initialUuid)?.kind !== 'compendium';
  const [worldUuid, setWorldUuid] = useState(startsInWorld ? initialUuid : '');
  const [packUuid, setPackUuid] = useState(startsInWorld ? '' : initialUuid);
  // The one picked last is the one looked up.
  const [last, setLast] = useState<'world' | 'pack'>(startsInWorld ? 'world' : 'pack');
  const [worldOpen, setWorldOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const worldNames = useRef(new Map<string, string>());
  const packNames = useRef(new Map<string, string>());
  const wanted = (last === 'world' ? worldUuid : packUuid).trim();
  const query = useQuery({
    queryKey: ['statblock-twin', wanted],
    queryFn: () => lookup(wanted),
    enabled: open && wanted !== '',
    staleTime: 60_000,
    retry: false,
  });
  const result = query.data;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="twin-drawer"
      title="🧛 2024 twin"
      sub="GM only. Read only: nothing is converted or changed."
      close={<DrawerClose data-track="dash.twin.close" />}
    >
      <label className={styles['pick']} htmlFor="twin-world">
        A monster in this world (an actor or a token on the scene you are viewing)
        <RefPicker
          fieldId="twin-world"
          refSpec={WORLD_REF}
          multiple={false}
          value={worldUuid}
          onChange={v => {
            setWorldUuid(v);
            setLast('world');
          }}
          parentValue=""
          open={worldOpen}
          onOpenChange={setWorldOpen}
          names={worldNames.current}
        >
          <input
            id="twin-world"
            className="field-control"
            type="text"
            autoComplete="off"
            value={worldUuid}
            onChange={e => {
              setWorldUuid(e.target.value);
              setLast('world');
            }}
          />
        </RefPicker>
      </label>
      <label className={styles['pick']} htmlFor="twin-pack">
        Or a monster from a compendium (Pick from list, then type a few letters of its name)
        <RefPicker
          fieldId="twin-pack"
          refSpec={PACK_REF}
          multiple={false}
          value={packUuid}
          onChange={v => {
            setPackUuid(v);
            setLast('pack');
          }}
          parentValue=""
          open={packOpen}
          onOpenChange={setPackOpen}
          names={packNames.current}
        >
          <input
            id="twin-pack"
            className="field-control"
            type="text"
            autoComplete="off"
            value={packUuid}
            onChange={e => {
              setPackUuid(e.target.value);
              setLast('pack');
            }}
          />
        </RefPicker>
      </label>
      {wanted === '' && (
        <p className="pf-detail">
          Pick a monster to see whether it has a 2024 version in the SRD. The book&apos;s own
          monsters, such as Strahd, have none and say so.
        </p>
      )}
      {query.isFetching && <p className="pf-detail">Looking…</p>}
      {query.isError && (
        <div className="preflight-summary pf-warn">
          Couldn&apos;t look this up. {errorText(query.error)}
        </div>
      )}
      {wanted !== '' && parseMonsterUuid(wanted) === null && (
        <p className="pf-detail">
          Use Pick from list to choose a monster; typed names are not looked up.
        </p>
      )}
      {result && result !== 'not-a-monster' && !query.isFetching && <Result found={result} />}
    </Drawer>
  );
}
