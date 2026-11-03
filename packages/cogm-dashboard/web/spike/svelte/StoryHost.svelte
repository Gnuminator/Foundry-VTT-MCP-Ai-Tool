<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

  import type { LoadParty } from '../shared/party';
  import Party from './Party.svelte';

  let { load }: { load: LoadParty } = $props();
  const client = new QueryClient();
  let open = $state(true);
</script>

<QueryClientProvider {client}>
  <Party {open} onOpenChange={v => (open = v)} {load} planPace={async () => {}} />
</QueryClientProvider>
