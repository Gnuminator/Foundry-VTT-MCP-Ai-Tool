import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ToastProvider } from './components/Toasts';
import { applyCachedTheme } from './lib/theme';
import './next.css';

// Before the first paint: the last theme this browser saw.
applyCachedTheme();

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
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
);
