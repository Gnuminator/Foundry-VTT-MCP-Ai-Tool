// The decorator every story runs inside (registered in .storybook/preview.tsx): the same providers
// as main.tsx and App.tsx (TanStack Query, tooltips, toasts, the help pane, the confirm window), a
// fresh QueryClient per story, and the fake /api of fakeApi.ts. A story tunes it with
// `parameters.dashboard`:
//
//   api    what /api answers (fakeApi.ts); merged over the defaults below
//   cache  query data to start with: pairs of [query key, data], for what the live stream fills
//          (settings, the bridge link, the world, module errors) and nothing is fetched for
//
// Nothing here is bundled into the app: only .stories.tsx files and .storybook/ import it.
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import type { Decorator, Preview } from '@storybook/react-vite';
import { useState, type JSX, type ReactNode } from 'react';

import { ConfirmProvider } from '../components/ConfirmDialog';
import { HelpProvider } from '../components/Help';
import { ToastProvider } from '../components/Toasts';
import { BRIDGE_STATUS_KEY, SETTINGS_KEY, WORLD_KEY } from '../lib/stream';
import { TooltipProvider } from '../ui';

import { makeFetch, reply, toolOk, type FakeApi } from './fakeApi';
import { HELP_PAGE, PLAY_SESSION_CLOSED, WORLD } from './fixtures/common';

export interface DashboardParameters {
  api?: FakeApi;
  cache?: readonly (readonly [QueryKey, unknown])[];
}

/** What every story gets unless it says otherwise: the stream is up, GM Actions are on. */
const DEFAULT_API: FakeApi = {
  routes: {
    '/api/theme': reply({ theme: 'neutral' }),
    '/api/usage': { status: 204 },
    '/api/space': reply({ available: false }),
    '/api/help/*': reply(HELP_PAGE),
  },
  tools: {
    'get-play-session': toolOk(PLAY_SESSION_CLOSED),
  },
};

const DEFAULT_CACHE: readonly (readonly [QueryKey, unknown])[] = [
  [SETTINGS_KEY, { gmActionsEnabled: true }],
  [
    BRIDGE_STATUS_KEY,
    {
      controlChannel: 'connected',
      foundry: 'reachable',
      lastError: null,
      lastPollAt: null,
      foundryDownSince: null,
    },
  ],
  [WORLD_KEY, WORLD],
];

let realFetch: typeof fetch | null = null;

/** Puts the fake in place of window.fetch; the returned function takes it out again. */
function installFetch(api: FakeApi): () => void {
  realFetch ??= window.fetch.bind(window);
  const mine = makeFetch(api, realFetch);
  window.fetch = mine;
  return (): void => {
    // The next story may already have its own in place (its render runs before this cleanup).
    if (window.fetch === mine && realFetch) window.fetch = realFetch;
  };
}

function mergeApi(story: FakeApi | undefined): FakeApi {
  return {
    routes: { ...DEFAULT_API.routes, ...story?.routes },
    tools: { ...DEFAULT_API.tools, ...story?.tools },
  };
}

function Dashboard({
  config,
  children,
}: {
  config: DashboardParameters;
  children: ReactNode;
}): JSX.Element {
  // Once per story: the key on this component (below) remounts it when the story changes. The
  // fake fetch is not set up here: that is a side effect, and it belongs to dashboardBeforeEach.
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      // A story shows what the fake answers; a retry would only delay a failure it is showing.
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    for (const [key, data] of [...DEFAULT_CACHE, ...(config.cache ?? [])]) {
      queryClient.setQueryData(key, data);
    }
    return queryClient;
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <HelpProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </HelpProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/**
 * Storybook's per-story setup step (registered as `beforeEach` in .storybook/preview.tsx): it
 * runs once before the story renders and the function it returns runs when the story is torn
 * down. The fake /api is in place before any component fetches, and a strict-mode double
 * render cannot swap it out from under the live story.
 */
export const dashboardBeforeEach: NonNullable<Preview['beforeEach']> = context => {
  const config = (context.parameters['dashboard'] ?? {}) as DashboardParameters;
  return installFetch(mergeApi(config.api));
};

export const withDashboard: Decorator = (Story, context) => {
  const config = (context.parameters['dashboard'] ?? {}) as DashboardParameters;
  return (
    <Dashboard key={context.id} config={config}>
      <Story />
    </Dashboard>
  );
};
