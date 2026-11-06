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
  type StatBlock,
  type TwinVerdict,
} from '../lib/statblockTwin';
import type { ToolRef } from '../lib/toolForm';
import { Button, Card } from '../ui';

import styles from './StatblockTwin.module.css';

/** World actors and compendium actors; the value is the uuid. */
const MONSTER_REF: ToolRef = {
  kind: ['actor', 'compendium-entry'],
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

interface SearchAnswer {
  results?: { id?: string; name?: string; pack?: { id?: string } }[];
}

async function lookup(uuid: string): Promise<Found | 'not-a-monster'> {
  const ref = parseMonsterUuid(uuid);
  if (!ref) return 'not-a-monster';
  const block =
    ref.kind === 'world'
      ? statBlockFromActor(await callTool('get-character', { identifier: ref.id }))
      : statBlockFromCompendium(
          await callTool('get-compendium-item', { packId: ref.pack, itemId: ref.id })
        );
  if (!block) throw new Error('This monster has no stat block to show.');
  const left = { uuid, block };
  if (ref.kind === 'compendium' && ref.pack === TWIN_PACK) {
    return { left, verdict: { kind: 'already-2024' }, right: null };
  }
  const found = await callTool<SearchAnswer>('search-compendium', {
    query: block.name,
    packType: 'Actor',
    limit: 50,
  });
  const inPack = (found.results ?? []).filter(r => r.pack?.id === TWIN_PACK && r.id && r.name);
  const verdict = decideTwin(
    block.name,
    inPack.map(r => r.name ?? '')
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
      {verdict.kind === 'already-2024' && (
        <div className="preflight-summary" id="twin-already">
          This is already a 2024 monster. Pick the 2014 one to see its twin.
        </div>
      )}
      {verdict.kind === 'twin' && right && (
        <p className={`pf-detail ${styles['note']}`} id="twin-found">
          Same monster, 2024 text. The 2014 CR balances the book&apos;s encounters
          {left.block.cr !== right.block.cr
            ? `; the 2024 one is CR ${formatCr(right.block.cr)} against ${formatCr(left.block.cr)}.`
            : '.'}{' '}
          You choose which one to run.
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
  const [uuid, setUuid] = useState(initialUuid);
  const [pickerOpen, setPickerOpen] = useState(false);
  const names = useRef(new Map<string, string>());
  const wanted = uuid.trim();
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
      <label className={styles['pick']} htmlFor="twin-monster">
        Monster (a world actor or a compendium entry)
        <RefPicker
          fieldId="twin-monster"
          refSpec={MONSTER_REF}
          multiple={false}
          value={uuid}
          onChange={v => {
            setUuid(v);
          }}
          parentValue=""
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          names={names.current}
        >
          <input
            id="twin-monster"
            className="field-control"
            type="text"
            autoComplete="off"
            value={uuid}
            onChange={e => setUuid(e.target.value)}
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
      {result === 'not-a-monster' && (
        <div className="preflight-summary pf-warn">
          That is not a monster. Pick an actor from the list.
        </div>
      )}
      {result && result !== 'not-a-monster' && !query.isFetching && <Result found={result} />}
    </Drawer>
  );
}
