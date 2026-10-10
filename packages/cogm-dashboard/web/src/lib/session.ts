// The play session (get-play-session on the bridge): whether the table is playing, and when the
// last session ended. The moment tabs (Moments.tsx) follow it, and Ready for session offers to
// start the session log while none is open.
import { useQuery } from '@tanstack/react-query';

import { callTool } from './api';

/** The fields of the bridge's answer this page uses (tools/play-session.ts on the server). */
export interface PlaySession {
  open: boolean;
  /** When a closed session ended (its end marker, or its last activity); null while open. */
  endedAt: string | null;
}

export const PLAY_SESSION_KEY = ['play-session'] as const;

/**
 * The play session, polled each minute as the old page does. A failed poll keeps the last answer
 * (a query keeps its data on error). `failed` stays true once a read failed with no answer yet,
 * also while the next poll runs. `checkedAt` is when the last answer came. Another panel that
 * mounts (Ready for session) shares the last answer instead of asking again.
 */
export function usePlaySession(): {
  session: PlaySession | undefined;
  failed: boolean;
  checkedAt: number;
  refetch: () => Promise<unknown>;
} {
  const query = useQuery({
    queryKey: PLAY_SESSION_KEY,
    queryFn: async (): Promise<PlaySession> => {
      const s = await callTool<{ open?: unknown; endedAt?: unknown } | null>(
        'get-play-session',
        {}
      );
      return {
        open: s?.open === true,
        endedAt: typeof s?.endedAt === 'string' ? s.endedAt : null,
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
    retryOnMount: false,
  });
  return {
    session: query.data,
    failed: query.errorUpdatedAt > 0,
    checkedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}
