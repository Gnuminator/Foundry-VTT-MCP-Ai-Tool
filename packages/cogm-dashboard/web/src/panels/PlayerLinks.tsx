// Player links (I-096): one private link per player to their own read-only character page
// (/me?k=...). The page shows only the characters that player's Foundry user owns. Making a new
// link turns the old one off; removing a link turns it off without a new one. Routes: me-route.ts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { OverlayPane } from '../components/OverlayPane';
import { useToast } from '../components/Toasts';
import { api, errorText } from '../lib/api';

export interface PlayerLink {
  userId: string;
  name: string;
  /** `/me?k=<key>`, or null while the player has no link. */
  link: string | null;
  createdAt: number | null;
}

const LINKS_KEY = ['player-links'] as const;
const linkPath = (userId: string): string => `/api/player-links/${encodeURIComponent(userId)}`;

async function copyLink(path: string): Promise<void> {
  await navigator.clipboard.writeText(new URL(path, location.origin).href);
}

function LinkRow({ player }: { player: PlayerLink }): JSX.Element {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: LINKS_KEY });
  const fail = (err: unknown): void => toast(`✗ ${errorText(err)}`, 'err');

  const make = useMutation({
    mutationFn: () => api<{ link: string }>(linkPath(player.userId), { method: 'POST' }),
    onSuccess: async ({ link }) => {
      await refresh();
      await copyLink(link).then(
        () => toast('✓ Link copied. Send it to that player only.'),
        () => toast('✓ Link made. Use Copy link to copy it.')
      );
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api<{ removed: boolean }>(linkPath(player.userId), { method: 'DELETE' }),
    onSuccess: async () => {
      toast('✓ Link removed. It no longer opens anything.');
      await refresh();
    },
    onError: fail,
  });
  const busy = make.isPending || remove.isPending;
  const { link } = player;

  return (
    <li data-user={player.userId}>
      <span className="links-name">{player.name}</span>
      <span className="links-state">
        {link && player.createdAt !== null
          ? `link made ${new Date(player.createdAt).toLocaleDateString()}`
          : 'no link'}
      </span>
      <span className="links-actions">
        {link ? (
          <>
            <button
              className="btn"
              data-track="dash.links.copy"
              disabled={busy}
              onClick={() => {
                copyLink(link).then(
                  () => toast('✓ Link copied. Send it to that player only.'),
                  fail
                );
              }}
            >
              Copy link
            </button>
            <button
              className="btn"
              data-track="dash.links.replace"
              title="A new link; the old one stops working"
              disabled={busy}
              onClick={() => make.mutate()}
            >
              New link
            </button>
            <button
              className="btn"
              data-track="dash.links.remove"
              title="The link stops working"
              disabled={busy}
              onClick={() => remove.mutate()}
            >
              Remove
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            data-track="dash.links.make"
            disabled={busy}
            onClick={() => make.mutate()}
          >
            Make link
          </button>
        )}
      </span>
    </li>
  );
}

/** The list; mounted only while the panel is open, so every opening loads it fresh. */
function LinksBody(): JSX.Element {
  const links = useQuery({
    queryKey: LINKS_KEY,
    queryFn: () => api<{ players: PlayerLink[] }>('/api/player-links'),
    staleTime: 0,
  });

  if (links.isPending) return <p className="empty">Loading…</p>;
  if (links.isError) {
    return <p className="empty">Could not load the player links: {errorText(links.error)}</p>;
  }
  const { players } = links.data;
  if (players.length === 0) {
    return (
      <p className="empty">No players yet. Players appear here once the world has non-GM users.</p>
    );
  }
  return (
    <>
      <p className="links-note">
        Send each player their own link (a direct message, not the table chat). It opens their
        character sheet on a phone or laptop, read-only, and stays up to date during play.
      </p>
      <ul className="links-list">
        {players.map(p => (
          <LinkRow key={p.userId} player={p} />
        ))}
      </ul>
    </>
  );
}

export function PlayerLinksPane({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <OverlayPane
      open={open}
      onOpenChange={onOpenChange}
      title="Player links"
      meta="read-only character sheets"
      closeLabel="Close player links"
    >
      <LinksBody />
    </OverlayPane>
  );
}
