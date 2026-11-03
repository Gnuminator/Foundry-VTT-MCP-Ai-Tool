import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState, type JSX } from 'react';

import { httpLoad, httpPlanPace } from '../shared/party';

const Party = lazy(() => import('./Party'));
const client = new QueryClient();

export function App(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState(false);
  return (
    <QueryClientProvider client={client}>
      <button
        type="button"
        className="spk-open"
        onClick={() => {
          setWanted(true);
          setOpen(true);
        }}
      >
        Party
      </button>
      {wanted && (
        <Suspense fallback={null}>
          <Party open={open} onOpenChange={setOpen} load={httpLoad} planPace={httpPlanPace} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
