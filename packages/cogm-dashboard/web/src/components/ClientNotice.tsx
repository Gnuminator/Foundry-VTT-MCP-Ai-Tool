import { useQuery } from '@tanstack/react-query';
import type { ClientVersionsView } from '@gnuminator/shared';
import type { JSX } from 'react';

import { api } from '../lib/api';
import {
  CLIENT_VERSIONS_KEY,
  CLIENT_VERSIONS_REFETCH_MS,
  clientBanners,
  splitAtLink,
} from '../lib/clientNotices';

function Line({ text, link }: { text: string; link: string | null }): JSX.Element {
  const [before, url] = splitAtLink(text, link);
  return (
    <>
      {before}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      ) : null}
    </>
  );
}

/**
 * One banner per outdated GM piece (Claude Desktop connectors, Obsidian plugin), Danish first and
 * English below. Silent while loading, on an error and on an older server without the route.
 */
export function ClientNotice(): JSX.Element | null {
  const { data } = useQuery({
    queryKey: CLIENT_VERSIONS_KEY,
    queryFn: () => api<ClientVersionsView>('/api/client-versions'),
    refetchInterval: CLIENT_VERSIONS_REFETCH_MS,
    retry: false,
  });
  const banners = clientBanners(data);
  if (banners.length === 0) return null;
  return (
    <>
      {banners.map(b => (
        <div className="link-banner client-banner" role="status" key={b.piece}>
          <div>
            <Line text={b.da} link={b.link} />
          </div>
          <div className="client-banner-en">
            <Line text={b.en} link={b.link} />
          </div>
        </div>
      ))}
    </>
  );
}
