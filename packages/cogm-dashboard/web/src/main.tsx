// First, so the old stylesheets and themes come before every component's CSS Module in the build
// (they used to be linked ahead of the bundle); styles/index.css has the order inside.
import './styles/index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { RootBoundary } from './components/RootBoundary';
import { ToastProvider } from './components/Toasts';
import { sendPlayersToPlayerPage } from './lib/role';
import { applyCachedTheme } from './lib/theme';
import { TooltipProvider } from './ui';

// Before the first paint: the last theme this browser saw.
applyCachedTheme();
// A player who opened this page lands on the player view (lib/role.ts).
void sendPlayersToPlayerPage();

const queryClient = new QueryClient({
  defaultOptions: {
    // A dashboard route that fails says why; one retry covers a blip, the panel then shows it.
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <RootBoundary>
            <App />
          </RootBoundary>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
);
