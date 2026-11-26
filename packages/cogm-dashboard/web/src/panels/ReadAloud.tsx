// The read-aloud shelf (I-167): the boxed read-aloud text of the pages the scene links (pages
// a link names first, then whole-entry pages by sort order), one block per box. "Copy" puts one block on the clipboard; "Show" opens it full size to
// read from. Read from the world each time the drawer opens through get-read-aloud: nothing is
// stored here or in the repo. GM only, read only.
import { useQuery } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { PageKnows } from '../components/PageKnows';
import { useToast } from '../components/Toasts';
import { callTool, errorText } from '../lib/api';
import { Button, QueryState } from '../ui';

import styles from './ReadAloud.module.css';

interface ReadAloudPage {
  pageId?: string;
  journalName: string;
  pageName: string;
  from: 'scene' | 'note';
  blocks: { text: string }[];
}

interface ReadAloudAnswer {
  sceneName: string;
  pages: ReadAloudPage[];
  pagesWithoutBoxes: number;
  /** Text pages the scene links in all, and how many of them were read. */
  linkedPages: number;
  readPages: number;
}

/** "Showing 12 of 15 linked pages", or null when every linked page was read. */
function cutNote(a: ReadAloudAnswer): string | null {
  return a.linkedPages > a.readPages
    ? `Showing the first ${a.readPages} of ${a.linkedPages} linked pages.`
    : null;
}

const READ_ALOUD_KEY = ['read-aloud'] as const;

/** One tool call; the answer's lists are checked so a short reply cannot break the drawer. */
async function loadReadAloud(): Promise<ReadAloudAnswer> {
  const raw = await callTool<Partial<ReadAloudAnswer> | null>('get-read-aloud', {});
  return {
    sceneName: raw?.sceneName ?? '',
    pages: Array.isArray(raw?.pages) ? raw.pages : [],
    pagesWithoutBoxes: raw?.pagesWithoutBoxes ?? 0,
    linkedPages: raw?.linkedPages ?? 0,
    readPages: raw?.readPages ?? 0,
  };
}

/** Why the shelf is empty: no linked page at all, or linked pages that have no boxed text. */
function emptyMessage(a: ReadAloudAnswer): string {
  return a.pagesWithoutBoxes > 0
    ? 'The pages this scene links have no boxed read-aloud text.'
    : 'This scene links no journal page, so there is nothing to read aloud.';
}

function Block({ text, label }: { text: string; label: string }): JSX.Element {
  const toast = useToast();
  const [shown, setShown] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast('✓ Copied.', 'ok');
    } catch (err) {
      toast(`✗ Could not copy: ${errorText(err)}`, 'err');
    }
  };
  return (
    <li className={styles['block']}>
      <p className={shown ? styles['full'] : styles['clamp']}>{text}</p>
      <div className={styles['actions']}>
        <Button
          data-track="dash.readaloud.show"
          aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}
          onClick={() => setShown(s => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </Button>
        <Button
          data-track="dash.readaloud.copy"
          aria-label={`Copy ${label}`}
          onClick={() => void copy()}
        >
          Copy
        </Button>
      </div>
    </li>
  );
}

export function ReadAloudDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const query = useQuery({
    queryKey: READ_ALOUD_KEY,
    queryFn: loadReadAloud,
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="readaloud-drawer"
      title="📖 Read-aloud"
      sub="GM only. Read from the journal pages the scene links; nothing is saved."
      close={<DrawerClose data-track="dash.readaloud.close" />}
    >
      <QueryState
        query={query}
        errorLabel="Couldn't load the read-aloud text"
        isEmpty={a => a.pages.length === 0}
        empty={a => emptyMessage(a)}
        detect
        onRetry={() => void query.refetch()}
      >
        {a => (
          <>
            {a.sceneName && <p className="pf-detail">Scene: {a.sceneName}</p>}
            {cutNote(a) && <p className="pf-detail">{cutNote(a)}</p>}
            {a.pages.map((page, p) => (
              <section key={`${page.journalName}.${page.pageName}.${p}`} className={styles['page']}>
                <h3 className={styles['pageTitle']}>
                  {page.pageName || page.journalName}
                  {page.from === 'note' && <span className={styles['pin']}> (map pin)</span>}
                </h3>
                {page.pageId && (
                  <PageKnows pageId={page.pageId} pageName={page.pageName || page.journalName} />
                )}
                <ol className={styles['blocks']}>
                  {page.blocks.map((b, i) => (
                    <Block
                      key={i}
                      text={b.text}
                      label={`block ${i + 1} of ${page.pageName || page.journalName}`}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </QueryState>
    </Drawer>
  );
}
